import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('relay authentication, pairing, isolation, forwarding and revocation', { timeout: 60000 }, async t => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, scriptPath: fileURLToPath(new URL('../src/worker.js', import.meta.url)), compatibilityDate: '2026-08-31', durableObjects: { PHONE_ROOMS: { className: 'PhoneRoom', useSQLite: true } } }));
  t.after(() => mf.dispose());
  const sockets = [];
  t.after(() => { for (const ws of sockets) { try { ws.close(); } catch {} } });
  const request = (room, role, overrides = {}) => mf.dispatchFetch(`http://relay.test/v2/rooms/${room}/${role}`, {
    headers: { Upgrade: 'websocket', Authorization: `Bearer ${'ab'.repeat(32)}`, 'X-WLSA-Protocol': '2', ...overrides },
  });
  async function connect(room, role) {
    const response = await request(room, role); assert.equal(response.status, 101);
    const ws = response.webSocket; ws.accept(); sockets.push(ws); return ws;
  }
  function event(ws, name, label = name) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.removeEventListener(name, handler); reject(new Error(`${label} timed out`)); }, 3000);
      const handler = value => { clearTimeout(timer); resolve(value); };
      ws.addEventListener(name, handler, { once: true });
    });
  }
  const health = await mf.dispatchFetch('http://relay.test/health');
  assert.equal((await health.json()).protocol, 2);
  const room = '12'.repeat(32);
  assert.equal((await request(room, 'phone', { Authorization: 'Bearer bad' })).status, 401);
  assert.equal((await request(room, 'phone', { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request(room, 'phone', { 'X-WLSA-Protocol': '1' })).status, 403);
  assert.equal((await request('invalid', 'phone')).status, 404);
  const phone = await connect(room, 'phone');
  assert.equal((await request(room, 'desktop', { Authorization: `Bearer ${'cd'.repeat(32)}` })).status, 403);
  const ready = event(phone, 'message');
  const desktop = await connect(room, 'desktop');
  assert.deepEqual(JSON.parse((await ready).data), { type: 'ready', protocol: 2 });
  const received = event(phone, 'message');
  desktop.send(new Uint8Array([1, 2, 3, 4]));
  assert.deepEqual([...new Uint8Array((await received).data)], [1, 2, 3, 4]);
  const otherRoom = '34'.repeat(32);
  const otherPhone = await connect(otherRoom, 'phone');
  const otherReady = event(otherPhone, 'message');
  const otherDesktop = await connect(otherRoom, 'desktop');
  await otherReady;
  let crossed = false;
  otherPhone.addEventListener('message', () => { crossed = true; });
  const firstMessage = event(phone, 'message'); desktop.send(new Uint8Array([5])); await firstMessage;
  assert.equal(crossed, false);
  const closed = event(desktop, 'close'); phone.close(); await closed;
  const independent = event(otherPhone, 'message'); otherDesktop.send(new Uint8Array([6]));
  assert.deepEqual([...new Uint8Array((await independent).data)], [6]);
  const oversized = event(otherDesktop, 'close'); otherPhone.send(new Uint8Array(65537));
  assert.equal((await oversized).code, 1008);

  const reconnectRoom = '56'.repeat(32);
  const oldPhone = await connect(reconnectRoom, 'phone');
  const oldReady = event(oldPhone, 'message');
  const oldDesktop = await connect(reconnectRoom, 'desktop');
  await oldReady;
  // Complete a round trip so both client sockets have finished coupling to
  // workerd before testing replacement of an established session.
  const oldData = event(oldPhone, 'message');
  oldDesktop.send(new Uint8Array([8]));
  await oldData;
  const oldClosed = event(oldDesktop, 'close', 'replaced desktop close');
  const newPhone = await connect(reconnectRoom, 'phone');
  await oldClosed;
  const newReady = event(newPhone, 'message');
  const newDesktop = await connect(reconnectRoom, 'desktop');
  await newReady;
  const afterReplacement = event(newPhone, 'message');
  newDesktop.send(new Uint8Array([7]));
  assert.deepEqual([...new Uint8Array((await afterReplacement).data)], [7]);
});
