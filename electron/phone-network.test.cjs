const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PhoneNetwork, validOverlayIp, validLoginUrl } = require('./phone-network.cjs');

test('phone network accepts only tailnet IPv4 addresses and hosted sign-in links', () => {
  for (const value of ['100.64.0.1', '100.127.255.255']) assert.equal(validOverlayIp(value), true);
  for (const value of ['100.63.0.1', '100.128.0.1', '127.0.0.1', '100.64.256.1', '100.064.1.1', 'evil', null]) assert.equal(validOverlayIp(value), false, String(value));
  assert.equal(validLoginUrl('https://login.tailscale.com/a/example'), true);
  for (const value of ['http://login.tailscale.com/', 'https://login.tailscale.com.evil/', 'https://login.tailscale.com@evil/', 'javascript:alert(1)', 'https://login.tailscale.com:4000/']) assert.equal(validLoginUrl(value), false);
});

test('persists pairing through native credential protection and forgets only the pair', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsa-phone-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let encryptions = 0;
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => { encryptions++; return Buffer.from(text); }, decryptString: bytes => bytes.toString() };
  const make = () => new PhoneNetwork({ directory, runtimeDirectory: directory, safeStorage });
  const first = make(); await first.load(); const identity = first.saved.storageKey;
  first.saved.pair = { name: 'Phone', usbSerial: 'usb', peerIp: '100.64.0.2', secret: '12'.repeat(32) }; await first.save();
  const second = make(); await second.load(); assert.equal(second.getStatus().pairedPhone, 'Phone'); assert.equal(second.matchesUsb('usb'), true); assert.equal(second.matchesUsb('other'), false);
  await second.forget(); const third = make(); await third.load();
  assert.equal(third.saved.storageKey, identity); assert.equal(third.getStatus().pairedPhone, null); assert.ok(encryptions >= 3);
});

test('fails closed when native key protection or stored identity is unavailable', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(network.load(), /protection is unavailable/);
});

test('pairing rejects mismatched Tailscale networks before sending a secret', async t => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.status = { state: 'ready', ip: '100.64.0.1', tailnet: 'computer-network' };
  network.saved = {};
  network.start = async () => {};
  network.save = async () => {};
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, method: options.method || 'GET' });
    return { ok: true, json: async () => ({ state: 'ready', tailnet: 'other-network' }) };
  });
  const adb = [];
  const runAdb = async args => { adb.push(args.join(' ')); return { stdout: args.includes('tcp:0') ? '40001' : '' }; };
  await assert.rejects(network.pair(runAdb, 'USB123', () => {}, async () => {}), /Sign in to the same network/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.ok(adb.includes('-s USB123 forward --remove tcp:40001'));
});

test('endpoint preserves the preflight error rather than publishing an unusable ADB port', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.status = { state: 'ready' };
  network.saved = { pair: { peerIp: '100.64.0.2', name: 'Phone', secret: 'ab'.repeat(32) } };
  network.start = async () => {};
  network.command = async () => { throw new Error('The phone is not visible in this Tailscale network.'); };
  await assert.rejects(network.endpoint(), /not visible/);
});

test('switching accounts clears pairing but preserves protected identity and uses native logout', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.saved = { storageKey: 'ab'.repeat(32), hostname: 'wlsaplus-pc-12345678', pair: { name: 'Phone' }, pendingPair: { secret: 'old' } };
  const calls = [];
  network.load = async () => {};
  network.save = async () => { calls.push('save'); assert.equal(network.saved.pair, undefined); assert.equal(network.saved.pendingPair, undefined); };
  network.start = async () => { calls.push('start'); };
  network.command = async method => { calls.push(method); network.update({ state: 'needs-login', active: 0 }); };
  const status = await network.switchAccount();
  assert.deepEqual(calls, ['save', 'start', 'switch-account']);
  assert.equal(network.saved.storageKey, 'ab'.repeat(32));
  assert.equal(network.saved.hostname, 'wlsaplus-pc-12345678');
  assert.equal(status.pairedPhone, null);
  assert.equal(status.state, 'needs-login');
});

test('account switch does not proceed if pairing removal cannot be persisted', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  const saved = { pair: { name: 'Phone' } };
  network.saved = saved;
  network.load = async () => {};
  network.save = async () => { throw new Error('storage unavailable'); };
  network.start = async () => { assert.fail('started despite storage failure'); };
  await assert.rejects(network.switchAccount(), /storage unavailable/);
  assert.equal(network.saved, saved);
});

test('failed Tailscale sign-out leaves old pairing revoked and can be retried', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.saved = { pair: { name: 'Phone' } };
  network.load = network.save = network.start = async () => {};
  network.command = async () => { throw new Error('sign-out did not complete'); };
  await assert.rejects(network.switchAccount(), /sign-out did not complete/);
  assert.equal(network.saved.pair, undefined);
  network.command = async () => {};
  await network.switchAccount();
});
