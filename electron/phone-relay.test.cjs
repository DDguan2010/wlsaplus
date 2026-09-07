const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PhoneNetwork, validPair } = require('./phone-network.cjs');
const pair = () => ({ protocol: 2, name: 'Phone', secret: '12'.repeat(32), usbSerial: 'usb' });
const safeStorage = { isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: bytes => bytes.toString() };

test('relay pairs reject legacy protocols and malformed keys', () => {
  assert.equal(validPair(pair()), true);
  for (const value of [null, {}, { ...pair(), protocol: 1 }, { ...pair(), secret: 'short' }, { ...pair(), name: '' }]) assert.equal(validPair(value), false);
});
test('persists relay pairing through native protection and forgets only the pair', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsa-phone-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const make = () => new PhoneNetwork({ directory, runtimeDirectory: directory, safeStorage });
  const first = make(); await first.load(); const identity = first.saved.storageKey;
  first.saved.pair = pair(); await first.save();
  const second = make(); await second.load(); assert.equal(second.getStatus().pairedPhone, 'Phone'); assert.equal(second.matchesUsb('usb'), true);
  await second.forget(); const third = make(); await third.load(); assert.equal(third.saved.storageKey, identity); assert.equal(third.getStatus().pairedPhone, null);
});
test('upgrading a Tailscale pairing requests USB approval without resetting the protected identity', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsa-phone-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const first = new PhoneNetwork({ directory, safeStorage }); await first.load(); const identity = first.saved.storageKey;
  first.saved.pair = { peerIp: '100.64.0.2', name: 'Old phone', secret: '12'.repeat(32) }; await first.save();
  const upgraded = new PhoneNetwork({ directory, safeStorage }); await upgraded.load();
  assert.equal(upgraded.saved.storageKey, identity); assert.equal(upgraded.getStatus().pairedPhone, null); assert.equal(upgraded.getStatus().repairRequired, true);
});
test('fails closed when native key protection is unavailable', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: { isEncryptionAvailable: () => false } });
  await assert.rejects(network.load(), /protection is unavailable/);
});

test('failed pairing removal remains visible and can be retried', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage });
  network.saved = { pair: pair() };
  network.save = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(network.forget(), /disk unavailable/);
  assert.equal(network.getStatus().pairedPhone, 'Phone');
  network.save = async () => {};
  await network.forget();
  assert.equal(network.getStatus().pairedPhone, null);
});
test('pairing rejects old Android before sending a secret and cleans up its USB port', async t => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.status = { state: 'ready', protocol: 2 }; network.saved = {}; network.start = network.save = async () => {};
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push(options.method || 'GET'); return { ok: true, json: async () => ({ state: 'ready', tailnet: 'legacy' }) }; });
  const adb = [];
  await assert.rejects(network.pair(async args => { adb.push(args.join(' ')); return { stdout: args.includes('tcp:0') ? '40001' : '' }; }, 'USB123', () => {}, async () => {}), /updated WLSAPlus Android/);
  assert.deepEqual(calls, ['GET']); assert.ok(adb.includes('-s USB123 forward --remove tcp:40001'));
});
test('USB approval saves protocol 2 and never needs a hosted account', async t => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} }); network.status = { protocol: 2 }; network.saved = {}; network.start = network.save = async () => {};
  t.mock.method(globalThis, 'fetch', async (url, options) => ({ ok: true, status: 200, json: async () => options.method === 'POST' ? { accepted: true, protocol: 2 } : { protocol: 2 } }));
  await network.pair(async args => ({ stdout: args.includes('tcp:0') ? '40001' : '' }), 'USB123', message => assert.match(message, /approve matching code/), async () => {});
  assert.equal(validPair(network.saved.pair), true); assert.equal(network.saved.pendingPair, undefined);
});

test('USB pairing waits for a valid phone status before sending the secret', async t => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} });
  network.status = { protocol: 2 }; network.saved = {}; network.start = network.save = async () => {};
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(options.method || 'GET');
    if (calls.length === 1) throw new Error('phone still starting');
    return { ok: true, status: 200, json: async () => options.method === 'POST' ? { accepted: true, protocol: 2 } : { protocol: 2 } };
  });
  await network.pair(async args => ({ stdout: args.includes('tcp:0') ? '40001' : '' }), 'USB123', () => {}, async () => {});
  assert.deepEqual(calls, ['GET', 'GET', 'POST']);
  assert.equal(validPair(network.saved.pair), true);
});
test('endpoint preserves relay preflight failures and can retry while reconnecting', async () => {
  const network = new PhoneNetwork({ directory: '', safeStorage: {} }); network.status = { state: 'connecting', protocol: 2 }; network.saved = { pair: pair() }; network.start = async () => {};
  network.command = async () => { throw new Error('Cloudflare relay unavailable'); };
  await assert.rejects(network.endpoint(), /relay unavailable/);
  network.command = async () => ({ endpoint: '127.0.0.1:43123' }); assert.equal(await network.endpoint(), '127.0.0.1:43123');
});
