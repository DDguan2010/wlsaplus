const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

function validPair(value) {
  return value?.protocol === 2 && /^[a-f0-9]{64}$/.test(value.secret ?? '') && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 80;
}

class PhoneNetwork {
  constructor({ directory, runtimeDirectory, safeStorage, onStatus = () => {} }) {
    Object.assign(this, { directory, runtimeDirectory, safeStorage, onStatus });
    this.status = { state: 'stopped', active: 0 };
    this.pending = new Map(); this.nextId = 1; this.child = null; this.starting = null; this.saved = null;
    this.stopping = null; this.pairAbort = null;
    this.androidPackage = process.env.WLSAPLUS_PHONE_ANDROID_PACKAGE === 'cn.org.wlsash.wlsaplus.phonepreview'
      ? 'cn.org.wlsash.wlsaplus.phonepreview' : 'cn.org.wlsash.wlsaplus';
  }

  getStatus() { return { ...this.status, pairedPhone: this.saved?.pair?.name ?? null }; }
  matchesUsb(serial) { return this.saved?.pair?.usbSerial === serial; }
  update(status) { this.status = status; this.onStatus(this.getStatus()); }
  async load() {
    if (this.saved) return;
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error('Windows credential protection is unavailable.');
    await fs.mkdir(this.directory, { recursive: true });
    try { this.saved = JSON.parse(this.safeStorage.decryptString(await fs.readFile(path.join(this.directory, 'identity.bin')))); }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('The saved phone connection could not be read.'); }
    if (!this.saved) { this.saved = { storageKey: crypto.randomBytes(32).toString('hex'), hostname: `wlsaplus-pc-${crypto.randomBytes(4).toString('hex')}` }; await this.save(); }
    if (!/^[a-f0-9]{64}$/.test(this.saved.storageKey ?? '') || !/^wlsaplus-pc-[a-f0-9]{8}$/.test(this.saved.hostname ?? '')) {
      this.saved = null; throw new Error('The saved phone connection identity is damaged.');
    }
    if ((this.saved.pair && !validPair(this.saved.pair)) || (this.saved.pendingPair && !validPair(this.saved.pendingPair))) {
      const previous = this.saved;
      this.saved = { ...previous }; delete this.saved.pair; delete this.saved.pendingPair;
      try { await this.save(); } catch (error) { this.saved = null; throw error; }
      this.update({ state: 'stopped', active: 0, repairRequired: true });
    }
  }
  async save() {
    const file = path.join(this.directory, 'identity.bin');
    await fs.writeFile(`${file}.tmp`, this.safeStorage.encryptString(JSON.stringify(this.saved)), { mode: 0o600 });
    await fs.rename(`${file}.tmp`, file);
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.child) return this.getStatus();
    this.starting = this.startInternal().finally(() => { this.starting = null; });
    return this.starting;
  }
  async startInternal() {
    if (this.stopping) await this.stopping;
    await this.load();
    const executable = path.join(this.runtimeDirectory, 'phone-network.exe');
    try { await fs.access(executable); } catch { throw new Error('The secure phone connection component is missing. Reinstall WLSAPlus or build the phone network component.'); }
    const child = spawn(executable, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.status) this.update(message.status);
      if (message.id && this.pending.has(message.id)) {
        const request = this.pending.get(message.id); this.pending.delete(message.id); clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error)); else request.resolve(message.status);
      }
    });
    const failed = () => {
      if (this.child !== child) return;
      this.child = null;
      for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('The secure phone connection stopped. Try enabling it again.')); }
      this.pending.clear(); this.update({ state: 'stopped', active: 0 });
    };
    child.on('error', failed); child.on('close', failed);
    child.stdin.on('error', failed);
    try { await this.command('start', { role: 'desktop', dir: path.join(this.directory, 'state'), storageKey: this.saved.storageKey, hostname: this.saved.hostname }); }
    catch (error) { await this.dispose(); throw error; }
    return this.getStatus();
  }

  command(method, config = {}) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('Enable the secure connection first.'));
      const id = this.nextId++;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('The secure connection did not respond in time.')); }, method === 'connect' ? 60_000 : 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, method, config })}\n`, error => { if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); } });
    });
  }

  async pair(runAdb, usbSerial, onMessage, sleep) {
    await this.start();
    if (this.status.protocol !== 2) throw new Error('Update the Windows phone connection component first.');
    if (this.saved.pair) throw new Error('A phone is already paired. Forget the connection before pairing another phone.');
    const abort = new AbortController(); this.pairAbort = abort;
    const launch = await runAdb(['-s', usbSerial, 'shell', 'am', 'start', '-n', `${this.androidPackage}/cn.org.wlsash.wlsaplus.MainActivity`, '--ez', 'wlsaPhoneReceiver', 'true']);
    if (/Error:|does not exist/i.test(`${launch.stdout || ''} ${launch.stderr || ''}`)) throw new Error(`Install the ${this.androidPackage.endsWith('.phonepreview') ? 'WLSAPlus Phone Preview' : 'updated WLSAPlus'} Android app first.`);
    const { stdout } = await runAdb(['-s', usbSerial, 'forward', 'tcp:0', 'tcp:37183']);
    const port = Number(String(stdout).trim());
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Could not establish USB pairing. Reconnect the USB cable.');
    const previous = this.saved.pendingPair;
    const request = previous?.usbSerial === usbSerial && validPair(previous)
      ? { protocol: 2, name: previous.name, secret: previous.secret }
      : { protocol: 2, name: os.hostname().slice(0, 80), secret: crypto.randomBytes(32).toString('hex') };
    const digest = crypto.createHash('sha256').update(request.secret).digest();
    const code = String(digest.readUIntBE(0, 3) % 1_000_000).padStart(6, '0');
    onMessage(`On the phone, tap Enable connection and approve matching code ${code}. Keep USB connected until the phone window opens.`);
    try {
      // Persist the proposed secret before approval so an interrupted USB exchange
      // can resume without requiring the user to forget both devices.
      this.saved.pendingPair = { ...request, usbSerial }; await this.save();
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        if (abort.signal.aborted) throw new Error('Pairing cancelled.');
        const phoneStatus = await fetch(`http://127.0.0.1:${port}/status`, { headers: { 'X-WLSA-USB': '1' }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2_000)]) })
          .then(response => response.ok ? response.json() : null).catch(() => null);
        if (!phoneStatus) { await sleep(1_000); continue; }
        if (phoneStatus.protocol !== 2) throw new Error('Install the updated WLSAPlus Android app for Cloudflare phone connections.');
        if (phoneStatus?.relay && this.status.relay && phoneStatus.relay !== this.status.relay) throw new Error('The apps use different phone relays. Update both apps and try again.');
        const result = await fetch(`http://127.0.0.1:${port}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WLSA-USB': '1' }, body: JSON.stringify(request), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2_000)]) }).catch(() => null);
        if (result?.status === 409) throw new Error('This phone already trusts another computer. Forget it on the phone before pairing again.');
        if (result?.ok) {
          const pair = await result.json();
          if (pair.accepted && pair.protocol === 2) {
            if (abort.signal.aborted) throw new Error('Pairing cancelled.');
            this.saved.pair = { protocol: 2, secret: request.secret, name: 'Android phone', usbSerial };
            delete this.saved.pendingPair;
            await this.save(); return;
          }
        }
        await sleep(1_000);
      }
      throw new Error('Pairing timed out. Update WLSAPlus on Android, open Connect to computer, and try again.');
    } finally { if (this.pairAbort === abort) this.pairAbort = null; await runAdb(['-s', usbSerial, 'forward', '--remove', `tcp:${port}`]).catch(() => {}); }
  }

  async endpoint() {
    await this.start();
    if (!this.saved.pair) throw new Error('Pair the phone by USB first.');
    if (!validPair(this.saved.pair)) throw new Error('Update both apps and pair again by USB.');
    const result = await this.command('connect', this.saved.pair);
    if (!/^127\.0\.0\.1:\d+$/.test(result.endpoint ?? '')) throw new Error('Could not open the paired connection.');
    return result.endpoint;
  }

  async forget() {
    await this.dispose(); await this.load();
    const previous = this.saved;
    this.saved = { ...previous }; delete this.saved.pair; delete this.saved.pendingPair;
    try { await this.save(); } catch (error) { this.saved = previous; throw error; }
    this.update({ state: 'stopped', active: 0 });
  }
  dispose() {
    this.pairAbort?.abort();
    const child = this.child; this.child = null;
    if (child) {
      this.stopping = new Promise(resolve => {
        const timer = setTimeout(() => child.kill(), 3_000); timer.unref();
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.stdin.end();
      });
    }
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('Phone connection stopped.')); }
    this.pending.clear();
    this.update({ state: 'stopped', active: 0 });
    return this.stopping ?? Promise.resolve();
  }
}

module.exports = { PhoneNetwork, validPair };
