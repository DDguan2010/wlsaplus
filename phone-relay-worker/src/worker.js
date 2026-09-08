import { DurableObject } from 'cloudflare:workers';

const pathPattern = /^\/v2\/rooms\/([a-f0-9]{64})\/(phone|desktop)$/;
const tokenPattern = /^Bearer ([a-f0-9]{64})$/;
const idleRoomMs = 2 * 60 * 60 * 1000;

function reject(status, message) {
  return new Response(message, { status, headers: { 'Cache-Control': 'no-store' } });
}
function credentials(request) {
  const match = new URL(request.url).pathname.match(pathPattern);
  const token = request.headers.get('Authorization')?.match(tokenPattern)?.[1];
  return match && token ? { room: match[1], role: match[2], token } : null;
}
async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ service: 'wlsaplus-phone-relay', protocol: 2 }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'GET' || !pathPattern.test(url.pathname)) return reject(404, 'Not found');
    if (request.headers.has('Origin') || request.headers.get('X-WLSA-Protocol') !== '2') return reject(403, 'Native phone connection required');
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return reject(426, 'WebSocket required');
    const auth = credentials(request);
    if (!auth) return reject(401, 'Pairing credential required');
    if (env.CONNECT_LIMIT) {
      const key = request.headers.get('CF-Connecting-IP') || 'local';
      if (!(await env.CONNECT_LIMIT.limit({ key })).success) return reject(429, 'Retry later');
    }
    const id = env.PHONE_ROOMS.idFromName(auth.room);
    return env.PHONE_ROOMS.get(id, { locationHint: 'apac' }).fetch(request);
  },
};

// The relay never receives the USB pairing secret or TLS private keys.
// A room is an unguessable capability, with a separate bearer credential.
export class PhoneRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const auth = credentials(request);
    if (!auth || request.headers.has('Origin') || request.headers.get('X-WLSA-Protocol') !== '2') return reject(403, 'Forbidden');
    const tokenHash = await hash(auth.token);
    const allowed = await this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get('tokenHash');
      if (saved && saved !== tokenHash) return false;
      if (!saved) {
        await this.ctx.storage.put('tokenHash', tokenHash);
        await this.ctx.storage.setAlarm(Date.now() + idleRoomMs);
      }
      return true;
    });
    if (!allowed) return reject(403, 'Pairing credential mismatch');
    const existing = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.active);
    if (existing.some(ws => ws.deserializeAttachment().role === auth.role)) this.closePair(existing, 4001, 'Reconnecting');
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ role: auth.role, active: true, ready: false, window: Date.now(), windowBytes: 0, messages: 0 });
    this.ctx.acceptWebSocket(server);
    const sockets = this.ctx.getWebSockets().filter(ws => ws.deserializeAttachment()?.active);
    if (sockets.length === 2) {
      const session = crypto.randomUUID();
      for (const ws of sockets) ws.serializeAttachment({ ...ws.deserializeAttachment(), ready: true, session });
      for (const ws of sockets) ws.send(JSON.stringify({ type: 'ready', protocol: 2 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, message) {
    const meta = ws.deserializeAttachment();
    if (!meta?.active) return;
    const sockets = this.ctx.getWebSockets().filter(peer => {
      const state = peer.deserializeAttachment();
      return state?.active && state.session === meta.session;
    });
    if (!meta.ready || typeof message === 'string' || message.byteLength > 65536) {
      this.closePair(sockets, 1008, 'Invalid relay frame'); return;
    }
    if (Date.now() - meta.window >= 1000) { meta.window = Date.now(); meta.windowBytes = 0; meta.messages = 0; }
    meta.windowBytes += message.byteLength;
    meta.messages++;
    // Bound bursts without disconnecting a healthy long-running mirror.
    if (meta.windowBytes > 4 * 1024 * 1024 || meta.messages > 1024) {
      this.closePair(sockets, 1008, 'Relay quota reached'); return;
    }
    ws.serializeAttachment(meta);
    const peer = sockets.find(other => other !== ws && other.deserializeAttachment().role !== meta.role);
    if (!peer) { this.closePair(sockets, 4001, 'Peer disconnected'); return; }
    try { peer.send(message); } catch { this.closePair(sockets, 4001, 'Connection interrupted'); }
  }

  webSocketClose(ws) { this.disconnect(ws); }
  webSocketError(ws) { this.disconnect(ws); }
  disconnect(ws) {
    const meta = ws.deserializeAttachment();
    if (!meta?.active) return;
    this.closePair(this.ctx.getWebSockets().filter(peer => {
      const state = peer.deserializeAttachment();
      return peer === ws || (meta.session && state?.session === meta.session);
    }), 4001, 'Peer disconnected');
  }
  closePair(sockets, code, reason) {
    for (const ws of sockets) {
      ws.serializeAttachment({ ...ws.deserializeAttachment(), active: false });
      try { ws.close(code, reason); } catch { /* Already closed. */ }
    }
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.ctx.getWebSockets().some(ws => ws.deserializeAttachment()?.active)) {
        await this.ctx.storage.setAlarm(Date.now() + idleRoomMs);
      } else {
        await this.ctx.storage.deleteAll();
      }
    });
  }
}
