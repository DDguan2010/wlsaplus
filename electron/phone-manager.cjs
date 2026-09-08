const { execFile, spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ADB_PORT = 5555;
const PHONE_ACTIONS = Object.freeze({
  back: '4',
  home: '3',
  recents: '187',
  power: '26',
  'volume-up': '24',
  'volume-down': '25',
});

function parseAdbDevices(output) {
  return String(output || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', state = '', ...fields] = line.split(/\s+/);
      const properties = {};
      for (const field of fields) {
        const separator = field.indexOf(':');
        if (separator > 0) properties[field.slice(0, separator)] = field.slice(separator + 1);
      }
      return { serial, state, model: String(properties.model || '').replace(/_/g, ' '), properties };
    });
}

function isWirelessSerial(serial) {
  return /:\d+$/.test(serial) || serial.includes('_adb-tls-connect._tcp');
}

function isPrivateIpv4(address) {
  if (!net.isIPv4(address)) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseWifiIpv4(output) {
  const text = String(output || '');
  const candidates = [
    ...[...text.matchAll(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((match) => match[1]),
    ...[...text.matchAll(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//g)].map((match) => match[1]),
  ];
  return candidates.find(isPrivateIpv4) || null;
}

function buildScrcpyArguments(serial, options = {}) {
  const args = [
    '--serial', serial,
    '--window-title', options.windowTitle || 'WLSAPlus Phone',
    '--keep-active',
    '--disable-screensaver',
  ];
  if (options.turnScreenOff !== false) args.push('--turn-screen-off');
  if (options.relay) args.push('--max-size=1280', '--max-fps=30', '--video-bit-rate=2M', '--video-buffer=0');
  return args;
}

function phoneActionKeyCode(action) {
  const keyCode = PHONE_ACTIONS[action];
  if (!keyCode) throw new Error('Unsupported phone control action.');
  return keyCode;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandError(error, fallback) {
  const detail = String(error?.stderr || error?.stdout || error?.message || '').trim();
  return new Error(detail ? `${fallback} ${detail}` : fallback);
}

function isOfflineError(error) {
  return /\b(?:device )?offline\b|device .*not found|no devices\/emulators found|transport.*(?:closed|error)|connection (?:closed|reset)/i.test(error?.message || '');
}

function authorizationError() {
  return Object.assign(new Error('Unlock the phone and allow USB debugging for this computer, then reconnect.'), { code: 'ADB_AUTHORIZATION' });
}

class PhoneManager {
  constructor({ platform = process.platform, runtimeDirectory, network, onStatus = () => {}, exec = execFileAsync, spawnProcess = spawn, sleep = delay } = {}) {
    this.platform = platform;
    this.runtimeDirectory = runtimeDirectory;
    this.onStatus = onStatus;
    this.exec = exec;
    this.spawnProcess = spawnProcess;
    this.sleep = sleep;
    this.network = network;
    this.scrcpyProcess = null;
    this.operation = null;
    this.lastError = '';
    this.lastDevice = null;
    this.stopping = false;
    this.cancelled = false;
    this.recoveryTimer = null;
    this.recoveryGeneration = 0;
    this.recoveryAttempts = 0;
    this.recovering = false;
    this.mirrorOptions = null;
    this.status = {
      state: platform === 'win32' ? 'idle' : 'unsupported',
      message: platform === 'win32' ? 'Connect an Android phone by USB to begin.' : 'Phone control is available on Windows only.',
      deviceName: null,
      serial: null,
      ip: null,
      androidVersion: null,
      audioAvailable: null,
      screenOff: true,
    };
  }

  get adbPath() { return path.join(this.runtimeDirectory, 'adb.exe'); }
  get scrcpyPath() { return path.join(this.runtimeDirectory, 'scrcpy.exe'); }
  getStatus() { return { ...this.status }; }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
    return this.getStatus();
  }

  assertSupported() {
    if (this.platform !== 'win32') throw new Error('Phone control is available on Windows only.');
  }

  async runAdb(args, timeout = 15_000) {
    try {
      return await this.exec(this.adbPath, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
    } catch (error) {
      throw commandError(error, 'ADB command failed.');
    }
  }

  async recoverUsb(serial) {
    if (this.cancelled) throw new Error('Connection cancelled.');
    this.setStatus({ state: 'configuring', message: 'Waiting for USB debugging to reconnect. Keep the phone unlocked and USB connected...' });
    // Reconnect only this transport, never kill the shared ADB server.
    await this.runAdb(['-s', serial, 'reconnect'], 5_000).catch(() => {});
    for (let attempt = 0; attempt < 15; attempt++) {
      if (this.cancelled) throw new Error('Connection cancelled.');
      const { stdout } = await this.runAdb(['devices', '-l'], 5_000);
      const device = parseAdbDevices(stdout).find(device => device.serial === serial);
      if (device?.state === 'unauthorized') throw authorizationError();
      if (device?.state === 'device') return;
      await this.sleep(1_000);
    }
    throw Object.assign(new Error('USB debugging stayed offline. Unlock the phone, unplug and reconnect its USB cable, and approve the debugging prompt.'), { code: 'ADB_OFFLINE' });
  }

  async runUsbAdb(serial, args, timeout = 5_000) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (this.cancelled) throw new Error('Connection cancelled.');
      try { return await this.runAdb(['-s', serial, ...args], timeout); }
      catch (error) {
        if (/unauthorized|authentication failed/i.test(error.message)) throw authorizationError();
        if (!isOfflineError(error)) throw error;
        if (attempt === 2) throw Object.assign(new Error('USB debugging keeps going offline. Reconnect the USB cable, keep the phone unlocked, and try again.'), { code: 'ADB_OFFLINE' });
        await this.recoverUsb(serial);
        await this.sleep(500);
      }
    }
  }

  async enableWirelessDebugging(serial) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { stdout } = await this.runUsbAdb(serial, ['shell', 'getprop', 'service.adb.tcp.port']);
      if (String(stdout).trim() === String(ADB_PORT)) return;
      if (this.cancelled) throw new Error('Connection cancelled.');
      try { await this.runAdb(['-s', serial, 'tcpip', String(ADB_PORT)], 5_000); }
      catch (error) {
        if (/unauthorized|authentication failed/i.test(error.message)) throw authorizationError();
        if (!isOfflineError(error)) throw error;
        // tcpip may succeed but drop its own response when adbd restarts.
        // Verify the port after recovery instead of blindly restarting again.
      }
      await this.sleep(1_000);
    }
    const { stdout } = await this.runUsbAdb(serial, ['shell', 'getprop', 'service.adb.tcp.port']);
    if (String(stdout).trim() !== String(ADB_PORT)) throw new Error('Android did not enable wireless debugging. Reconnect USB and check Developer options.');
  }

  async findAuthorizedUsbDevice(timeout = 45_000) {
    const deadline = Date.now() + timeout;
    let previousState = '';
    while (Date.now() < deadline) {
      if (this.cancelled) throw new Error('Connection cancelled.');
      const { stdout } = await this.runAdb(['devices', '-l']);
      const usbDevices = parseAdbDevices(stdout).filter((device) => !isWirelessSerial(device.serial) && !device.serial.startsWith('emulator-'));
      if (usbDevices.length > 1) throw new Error('More than one USB Android device is connected. Disconnect the extra device and try again.');
      const [device] = usbDevices;
      if (device?.state === 'device') return device;
      if (device?.state === 'offline') {
        await this.recoverUsb(device.serial);
        continue;
      }

      const nextState = device?.state === 'unauthorized' ? 'waiting-authorization' : 'waiting-usb';
      if (nextState !== previousState) {
        this.setStatus(nextState === 'waiting-authorization'
          ? { state: nextState, message: 'Unlock the phone and tap Allow on the USB debugging prompt.' }
          : { state: nextState, message: 'Waiting for an Android phone connected by USB...' });
        previousState = nextState;
      }
      await this.sleep(1_000);
    }
    throw new Error(previousState === 'waiting-authorization'
      ? 'USB debugging was not authorized in time. Unlock the phone, allow this computer, and try again.'
      : 'No authorized USB Android phone was found. Check the cable and USB debugging, then try again.');
  }

  async connectWireless(serial, attempts = 5) {
    const secure = serial.startsWith('127.0.0.1:');
    if (secure) attempts = Math.min(attempts, 3);
    // ADB can retain an offline transport after adbd restarts in TCP mode.
    await this.runAdb(['disconnect', serial], 5_000).catch(() => {});
    let lastError = '';
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (this.cancelled) throw new Error('Connection cancelled.');
      try {
        await this.runAdb(['connect', serial], secure ? 25_000 : 5_000);
        const { stdout } = await this.runAdb(['-s', serial, 'get-state'], 5_000);
        if (String(stdout).trim() === 'device' && !this.cancelled) return;
        lastError = String(stdout).trim();
      } catch (error) {
        lastError = error.message;
      }
      if (/unauthorized|authentication failed/i.test(lastError)) {
        throw authorizationError();
      }
      if (attempt < attempts - 1) {
        await this.runAdb(['disconnect', serial], 5_000).catch(() => {});
        await this.sleep(750);
      }
    }
    await this.runAdb(['disconnect', serial], 5_000).catch(() => {});
    if (serial.startsWith('127.0.0.1:') && this.network) {
      const detail = this.network.getStatus().connectionError;
      if (detail) throw new Error(detail);
    }
    throw new Error(serial.startsWith('127.0.0.1:')
      ? 'The paired phone is unreachable. Enable Connect to computer on the phone and check the internet connection. After a phone restart, reconnect USB.'
      : 'The phone is not responding over Wi-Fi. This Wi-Fi may block communication between devices. Keep USB connected and try Connect by USB again.');
  }

  connect(options = {}) {
    if (this.operation) return this.operation;
    this.cancelRecovery();
    this.mirrorOptions = { turnScreenOff: options.turnScreenOff !== false };
    this.cancelled = false;
    this.operation = this.connectInternal(options)
      .catch((error) => {
        if (this.cancelled || this.recovering) return this.getStatus();
        this.setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not connect to the phone.' });
        throw error;
      })
      .finally(() => { this.operation = null; });
    return this.operation;
  }

  async connectInternal(options) {
    this.assertSupported();
    await this.stopProcess();
    this.setStatus({ state: 'waiting-usb', message: 'Checking the USB connection...', screenOff: options.turnScreenOff !== false });
    await this.runAdb(['start-server']);
    const device = await this.findAuthorizedUsbDevice();
    this.setStatus({ state: 'configuring', message: 'Reading phone and Wi-Fi information...' });

    // Serialize USB reads so a transport recovery cannot interrupt other reads.
    const { stdout: modelOutput } = await this.runUsbAdb(device.serial, ['shell', 'getprop', 'ro.product.model']);
    const { stdout: versionOutput } = await this.runUsbAdb(device.serial, ['shell', 'getprop', 'ro.build.version.release']);
    const { stdout: sdkOutput } = await this.runUsbAdb(device.serial, ['shell', 'getprop', 'ro.build.version.sdk']);
    const optionalNetworkRead = async args => this.runUsbAdb(device.serial, args).catch(error => {
      if (error.code === 'ADB_OFFLINE' || error.code === 'ADB_AUTHORIZATION' || this.cancelled) throw error;
      return { stdout: '' };
    });
    const { stdout: routeOutput } = await optionalNetworkRead(['shell', 'ip', 'route']);
    const addressResult = await optionalNetworkRead(['shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0']);
    const ip = parseWifiIpv4(`${addressResult.stdout}\n${routeOutput}`);

    const deviceName = String(modelOutput || device.model || 'Android phone').trim() || 'Android phone';
    const androidVersion = String(versionOutput || '').trim() || null;
    const sdk = Number.parseInt(String(sdkOutput || '').trim(), 10);
    let wirelessSerial = ip ? `${ip}:${ADB_PORT}` : null;
    this.setStatus({
      state: 'configuring',
      message: 'Enabling wireless debugging. Keep USB connected for a moment...',
      deviceName,
      androidVersion,
      audioAvailable: Number.isFinite(sdk) ? sdk >= 30 : null,
      ip,
      serial: wirelessSerial,
    });

    await this.enableWirelessDebugging(device.serial);
    this.setStatus({ state: 'connecting', message: `Connecting to ${deviceName} over Wi-Fi...` });
    let paired = false;
    try {
      if (!wirelessSerial) throw new Error('No direct Wi-Fi address is available.');
      await this.connectWireless(wirelessSerial, this.network ? 2 : 5);
    } catch (error) {
      if (!this.network || this.cancelled || error.code === 'ADB_AUTHORIZATION') throw error;
      wirelessSerial = await this.pairedEndpoint(device.serial);
      await this.connectWireless(wirelessSerial);
      paired = true;
    }

    this.lastDevice = { serial: wirelessSerial, ip, deviceName, androidVersion, sdk, paired };
    return this.launch(options);
  }

  async pairedEndpoint(usbSerial) {
    if (this.cancelled) throw new Error('Connection cancelled.');
    this.setStatus({ state: this.recovering ? 'reconnecting' : 'configuring', message: this.recovering
      ? 'Waiting for the paired phone to reconnect. Keep Connect to computer enabled on Android.'
      : 'Direct Wi-Fi is unavailable. Preparing the secure connection...' });
    await this.network.start();
    if (this.cancelled) throw new Error('Connection cancelled.');
    if (usbSerial && this.network.getStatus().pairedPhone && !this.network.matchesUsb(usbSerial)) throw new Error('A different phone is paired. Forget the saved phone on both devices before pairing this one.');
    if (!this.network.getStatus().pairedPhone) {
      if (!usbSerial) throw new Error('Keep USB connected and use Connect by USB once to approve the secure connection.');
      const pairingAdb = (args, timeout) => args[0] === '-s' && args[1] === usbSerial && !args.includes('--remove')
        ? this.runUsbAdb(usbSerial, args.slice(2), timeout)
        : this.runAdb(args, timeout);
      await this.network.pair(pairingAdb, usbSerial, message => this.setStatus({ state: 'configuring', message }), this.sleep);
    }
    return this.network.endpoint();
  }

  start(options = {}) {
    if (this.operation) return this.operation;
    this.cancelRecovery();
    this.mirrorOptions = { turnScreenOff: options.turnScreenOff !== false };
    this.cancelled = false;
    this.operation = this.startInternal(options)
      .catch((error) => {
        if (this.cancelled || this.recovering) return this.getStatus();
        this.setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not reopen the phone.' });
        throw error;
      })
      .finally(() => { this.operation = null; });
    return this.operation;
  }

  async startInternal(options) {
    this.assertSupported();
    if (!this.lastDevice && this.network) {
      await this.network.load();
      if (this.network.getStatus().pairedPhone) this.lastDevice = { deviceName: 'Android phone', paired: true, sdk: 0, ip: null, androidVersion: null };
    }
    if (!this.lastDevice) throw new Error('Set up the phone by USB before reopening it wirelessly.');
    await this.stopProcess();
    this.setStatus({ state: this.recovering ? 'reconnecting' : 'connecting', message: `Reconnecting to ${this.lastDevice.deviceName}...`, screenOff: options.turnScreenOff !== false });
    if (this.lastDevice.paired) this.lastDevice.serial = await this.pairedEndpoint();
    try { await this.connectWireless(this.lastDevice.serial); }
    catch (error) {
      if (!this.network || this.lastDevice.paired || this.cancelled || error.code === 'ADB_AUTHORIZATION') throw error;
      this.lastDevice.serial = await this.pairedEndpoint(); this.lastDevice.paired = true;
      await this.connectWireless(this.lastDevice.serial);
    }
    if (!this.lastDevice.sdk) {
      const { stdout } = await this.runAdb(['-s', this.lastDevice.serial, 'shell', 'getprop', 'ro.build.version.sdk']);
      this.lastDevice.sdk = Number.parseInt(stdout, 10) || 0;
    }
    return this.launch(options);
  }

  cancelRecovery() {
    this.recoveryGeneration++;
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    this.recoveryAttempts = 0;
    this.recovering = false;
  }

  scheduleRecovery() {
    if (this.cancelled || !this.mirrorOptions || !this.lastDevice) return;
    clearTimeout(this.recoveryTimer);
    if (this.recoveryAttempts >= 6) {
      this.cancelRecovery();
      this.setStatus({ state: 'error', message: 'The phone is still unavailable. Enable Connect to computer on Android, then select Open wirelessly. After a phone restart, reconnect USB.' });
      return;
    }
    this.recovering = true;
    this.setStatus({ state: 'reconnecting', message: 'Phone connection interrupted. Reconnecting automatically; select Cancel to stop.' });
    const generation = this.recoveryGeneration;
    const options = { ...this.mirrorOptions };
    const run = () => {
      this.recoveryTimer = null;
      if (this.cancelled || generation !== this.recoveryGeneration) return;
      // A mirror can disconnect before its original start call has settled.
      if (this.operation) { this.recoveryTimer = setTimeout(run, 100); return; }
      this.recoveryAttempts++;
      const operation = this.startInternal(options).catch(error => {
        if (this.cancelled || generation !== this.recoveryGeneration) return;
        if (/Android debugging is off|allow USB debugging|unauthorized|paired device key|approve this computer|different phone|pair the phone again/i.test(error.message)) {
          this.cancelRecovery();
          this.setStatus({ state: 'error', message: error.message });
        } else {
          this.scheduleRecovery();
        }
      }).finally(() => { if (this.operation === operation) this.operation = null; });
      this.operation = operation;
    };
    this.recoveryTimer = setTimeout(run, Math.min(2_000 * 2 ** this.recoveryAttempts, 15_000));
  }

  async launch(options) {
    if (this.cancelled) throw new Error('Connection cancelled.');
    const device = this.lastDevice;
    if (!device) throw new Error('No wireless phone is configured.');
    this.lastError = '';
    const args = buildScrcpyArguments(device.serial, {
      turnScreenOff: options.turnScreenOff !== false,
      windowTitle: `WLSAPlus Phone - ${device.deviceName}`,
      relay: device.paired,
    });
    const child = this.spawnProcess(this.scrcpyPath, args, {
      cwd: this.runtimeDirectory,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.scrcpyProcess = child;
    child.stdout?.on('data', (chunk) => { this.lastError = `${this.lastError}${chunk}`.slice(-8_000); });
    child.stderr?.on('data', (chunk) => { this.lastError = `${this.lastError}${chunk}`.slice(-8_000); });
    child.on('error', (error) => {
      if (this.scrcpyProcess !== child || this.stopping) return;
      this.scrcpyProcess = null;
      this.setStatus({ state: 'error', message: `Could not start the phone window. ${error.message}` });
    });
    child.on('close', (code) => {
      if (this.scrcpyProcess !== child) return;
      this.scrcpyProcess = null;
      if (this.stopping) return;
      const detail = this.lastError.trim().split(/\r?\n/).filter(Boolean).at(-1);
      // scrcpy exit 2 means a lost device. Exit 0 is the user closing the window.
      if (!this.cancelled && code !== 0 && this.mirrorOptions &&
          (code === 2 || /device disconnected|device offline|connection (?:closed|reset)|broken pipe/i.test(this.lastError))) {
        this.scheduleRecovery();
        return;
      }
      if (code === 0) {
        this.mirrorOptions = null;
        this.cancelRecovery();
      }
      this.setStatus(code === 0
        ? { state: 'ready', message: 'Phone window closed. You can reopen it wirelessly.' }
        : { state: 'error', message: detail ? `Phone window closed: ${detail}` : 'Phone window closed unexpectedly.' });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 900);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); reject(new Error(`scrcpy exited with code ${code}. ${this.lastError.trim()}`.trim())); });
    });
    if (this.cancelled || this.scrcpyProcess !== child) throw new Error('Phone connection cancelled.');
    this.cancelRecovery();
    return this.setStatus({
      state: 'mirroring',
      message: device.sdk >= 30 ? 'Phone connected with video, sound, and controls.' : 'Phone connected. Audio needs Android 11 or newer.',
      deviceName: device.deviceName,
      androidVersion: device.androidVersion,
      audioAvailable: device.sdk >= 30,
      ip: device.ip,
      serial: device.serial,
      screenOff: options.turnScreenOff !== false,
    });
  }

  async stopProcess() {
    const child = this.scrcpyProcess;
    if (!child) return;
    this.stopping = true;
    this.scrcpyProcess = null;
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    this.stopping = false;
  }

  async stop() {
    this.assertSupported();
    this.cancelled = true;
    this.mirrorOptions = null;
    this.cancelRecovery();
    if (this.operation) {
      await this.network?.dispose();
      await this.operation.catch(() => {});
    }
    this.setStatus({ state: 'stopping', message: 'Closing the phone window...' });
    await this.stopProcess();
    return this.setStatus(this.lastDevice
      ? { state: 'ready', message: 'Phone window closed. You can reopen it wirelessly.' }
      : { state: 'idle', message: 'Connect an Android phone by USB to begin.' });
  }

  async disconnect() {
    this.assertSupported();
    this.cancelled = true;
    this.mirrorOptions = null;
    this.cancelRecovery();
    await this.network?.dispose();
    if (this.operation) await this.operation.catch(() => {});
    await this.stopProcess();
    if (this.lastDevice) await this.runAdb(['disconnect', this.lastDevice.serial]).catch(() => {});
    if (this.network) await this.network.forget();
    this.lastDevice = null;
    return this.setStatus({
      state: 'idle',
      message: 'Disconnected. Connect an Android phone by USB to begin.',
      deviceName: null,
      serial: null,
      ip: null,
      androidVersion: null,
      audioAvailable: null,
    });
  }

  async control(action) {
    this.assertSupported();
    if (!this.lastDevice || this.status.state !== 'mirroring') throw new Error('Open the phone window before using remote controls.');
    await this.runAdb(['-s', this.lastDevice.serial, 'shell', 'input', 'keyevent', phoneActionKeyCode(action)]);
    return this.getStatus();
  }

  dispose() {
    this.cancelled = true;
    this.mirrorOptions = null;
    this.cancelRecovery();
    this.stopping = true;
    const child = this.scrcpyProcess;
    this.scrcpyProcess = null;
    if (child && child.exitCode === null) child.kill();
    void this.network?.dispose();
  }
}

module.exports = {
  PHONE_ACTIONS,
  PhoneManager,
  buildScrcpyArguments,
  isWirelessSerial,
  parseAdbDevices,
  parseWifiIpv4,
  phoneActionKeyCode,
};
