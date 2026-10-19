import { DurableObject } from 'cloudflare:workers';

const ALLOWED_FORMATS = new Set(['clash', 'ss']);
export const DAILY_EGRESS_LIMIT_BYTES = 20_000_000_000;
const QUOTA_KEY = 'global';
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://wlsaplus.02studio.xyz',
  'https://wlsap.02studio.xyz',
  'https://wlsa.02studio.xyz',
]);

function corsOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const configured = String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const allowed = configured.length ? new Set(configured) : DEFAULT_ALLOWED_ORIGINS;
  return origin && allowed.has(origin) ? origin : null;
}

function responseHeaders(request, env, contentType = 'text/plain; charset=utf-8') {
  const headers = new Headers({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  const origin = corsOrigin(request, env);
  if (origin) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function json(request, env, value, status) {
  const headers = responseHeaders(request, env, 'application/json; charset=utf-8');
  return new Response(JSON.stringify(value), { status, headers });
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

async function reserveDailyEgress(env, bytes) {
  if (!env.SUBSCRIPTION_QUOTA) return { allowed: false, unavailable: true, remaining: 0 };
  const id = env.SUBSCRIPTION_QUOTA.idFromName(QUOTA_KEY);
  const stub = env.SUBSCRIPTION_QUOTA.get(id);
  const response = await stub.fetch('https://quota.internal/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: utcDay(), bytes }),
  });
  if (!response.ok) return { allowed: false, remaining: 0 };
  const result = await response.json();
  return {
    allowed: true,
    remaining: Number.isSafeInteger(result.remaining) ? result.remaining : 0,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = corsOrigin(request, env);
    if (request.method === 'OPTIONS') {
      const headers = responseHeaders(request, env);
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set('Access-Control-Allow-Headers', 'Accept, X-Subscription-Key');
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== 'GET' || url.pathname !== '/api/subscribe') {
      return json(request, env, { error: 'Not found' }, 404);
    }

    // An optional secret prevents casual third-party use. It is deliberately
    // optional so existing desktop builds continue to work during rollout.
    const requiredKey = String(env.SUBSCRIPTION_ACCESS_KEY || '').trim();
    if (requiredKey && request.headers.get('X-Subscription-Key') !== requiredKey) {
      return json(request, env, { error: 'Unauthorized' }, 401);
    }

    const format = (url.searchParams.get('format') || 'clash').toLowerCase();
    if (!ALLOWED_FORMATS.has(format)) {
      return json(request, env, { error: 'Unsupported format' }, 400);
    }
    const upstreamValue = String(env.UPSTREAM_SUBSCRIPTION_URL || '').trim();
    if (!upstreamValue) return json(request, env, { error: 'Subscription is not configured' }, 503);

    let upstream;
    try {
      upstream = new URL(upstreamValue);
      if (upstream.protocol !== 'https:') throw new Error('The upstream must use HTTPS.');
      upstream.searchParams.set('format', format);
    } catch {
      return json(request, env, { error: 'Subscription configuration is invalid' }, 500);
    }

    const upstreamResponse = await fetch(upstream, {
      cf: { cacheTtl: 0, cacheEverything: false },
      headers: {
        Accept: format === 'clash' ? 'text/yaml, text/plain;q=0.9, */*;q=0.8' : 'text/plain, */*;q=0.8',
        'User-Agent': 'WLSAPlus-Subscription-Relay/1.0',
      },
      redirect: 'follow',
    });
    if (!upstreamResponse.ok) {
      return json(request, env, { error: `Upstream returned HTTP ${upstreamResponse.status}` }, 502);
    }

    // Buffer the subscription so the Durable Object can reserve the exact
    // number of bytes before any of the response is sent to the client.
    const payload = await upstreamResponse.arrayBuffer();
    const quota = await reserveDailyEgress(env, payload.byteLength);
    if (quota.unavailable) {
      return json(request, env, { error: 'Daily quota storage is not configured' }, 503);
    }
    if (!quota.allowed) {
      return json(request, env, {
        error: 'The shared daily subscription transfer limit has been reached. Try again tomorrow.',
        limitBytes: DAILY_EGRESS_LIMIT_BYTES,
      }, 429);
    }

    const headers = responseHeaders(request, env, upstreamResponse.headers.get('Content-Type') || 'text/plain; charset=utf-8');
    headers.set('Content-Length', String(payload.byteLength));
    headers.set('X-WLSAPlus-Daily-Limit-Bytes', String(DAILY_EGRESS_LIMIT_BYTES));
    headers.set('X-WLSAPlus-Daily-Remaining-Bytes', String(quota.remaining));
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    return new Response(payload, { status: 200, headers });
  },
};

export class DailyQuota extends DurableObject {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/reserve') {
      return new Response('Not found', { status: 404 });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return new Response('Invalid request', { status: 400 });
    }
    const bytes = Number(input?.bytes);
    const date = String(input?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > DAILY_EGRESS_LIMIT_BYTES) {
      return new Response('Invalid quota reservation', { status: 400 });
    }

    const result = await this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get('daily');
      const used = saved?.date === date && Number.isSafeInteger(saved.bytes) ? saved.bytes : 0;
      if (used + bytes > DAILY_EGRESS_LIMIT_BYTES) {
        return { allowed: false, remaining: 0 };
      }
      const next = used + bytes;
      await this.ctx.storage.put('daily', { date, bytes: next });
      return { allowed: true, remaining: DAILY_EGRESS_LIMIT_BYTES - next };
    });

    return Response.json(result, { status: result.allowed ? 200 : 429, headers: { 'Cache-Control': 'no-store' } });
  }
}
