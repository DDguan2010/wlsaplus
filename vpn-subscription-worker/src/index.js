import { DurableObject } from 'cloudflare:workers';

const ALLOWED_FORMATS = new Set(['clash', 'ss']);
export const DAILY_EGRESS_LIMIT_BYTES = 5_000_000_000;
const VPN_PROTOCOL_VERSION = '2';
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

function parseSubscriptionUserinfo(value) {
  if (!value) return null;
  const fields = {};
  for (const item of String(value).split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1) continue;
    const key = item.slice(0, separator).trim().toLowerCase();
    const raw = item.slice(separator + 1).trim();
    if (!/^(?:0|[1-9]\d*)$/.test(raw)) continue;
    try {
      fields[key] = BigInt(raw);
    } catch {
      // Ignore malformed provider fields and let the required-header guard fail closed.
    }
  }
  if (fields.upload === undefined || fields.download === undefined) return null;
  return { upload: fields.upload, download: fields.download, total: fields.upload + fields.download };
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

async function reserveDailyProviderUsage(env, totalBytes) {
  if (!env.SUBSCRIPTION_QUOTA) return { allowed: false, unavailable: true, remaining: 0 };
  const id = env.SUBSCRIPTION_QUOTA.idFromName(QUOTA_KEY);
  const stub = env.SUBSCRIPTION_QUOTA.get(id);
  const response = await stub.fetch('https://quota.internal/provider-usage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: utcDay(), totalBytes: totalBytes.toString() }),
  });
  let result = {};
  try { result = await response.json(); } catch { /* handled as an unavailable quota */ }
  return {
    allowed: response.ok && result.allowed === true,
    unavailable: !response.ok && response.status >= 500,
    remaining: Number.isSafeInteger(result.remaining) ? result.remaining : 0,
    usageBytes: Number.isSafeInteger(result.usageBytes) ? result.usageBytes : 0,
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
    if (request.method !== 'GET' || !['/api/subscribe', '/api/usage'].includes(url.pathname)) {
      return json(request, env, { error: 'Not found' }, 404);
    }

    const requestedProtocol = request.headers.get('X-WLSAPlus-VPN-Protocol') || url.searchParams.get('protocol');
    if (requestedProtocol !== VPN_PROTOCOL_VERSION) {
      const response = json(request, env, {
        error: 'This VPN relay requires a newer WLSAPlus version.',
        requiredProtocol: VPN_PROTOCOL_VERSION,
      }, 426);
      response.headers.set('X-WLSAPlus-VPN-Protocol', VPN_PROTOCOL_VERSION);
      return response;
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

    // subscription-userinfo is the provider's authoritative cumulative traffic
    // counter. Track its upload+download delta per UTC day before returning a
    // profile, so the relay cannot silently fall back to an unmetered profile.
    const providerUsage = parseSubscriptionUserinfo(upstreamResponse.headers.get('subscription-userinfo'));
    const requireProviderUsage = String(env.REQUIRE_PROVIDER_USAGE ?? 'true').toLowerCase() !== 'false';
    if (!providerUsage && requireProviderUsage) {
      return json(request, env, {
        error: 'The upstream subscription did not report traffic usage; access was blocked for safety.',
      }, 503);
    }
    let providerQuota = null;
    if (providerUsage) {
      providerQuota = await reserveDailyProviderUsage(env, providerUsage.total);
      if (providerQuota.unavailable) {
        return json(request, env, { error: 'Daily quota storage is not configured' }, 503);
      }
      if (!providerQuota.allowed) {
        return json(request, env, {
          error: 'The daily VPN traffic limit has been reached. Try again tomorrow.',
          limitBytes: DAILY_EGRESS_LIMIT_BYTES,
          usageBytes: providerQuota.usageBytes,
        }, 429);
      }
    }

    if (url.pathname === '/api/usage') {
      if (!providerUsage || !providerQuota) {
        return json(request, env, { error: 'The upstream subscription did not report traffic usage.' }, 503);
      }
      return json(request, env, {
        usageBytes: providerQuota.usageBytes,
        remainingBytes: providerQuota.remaining,
        limitBytes: DAILY_EGRESS_LIMIT_BYTES,
        source: 'subscription-userinfo',
      }, 200);
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
    headers.set('X-WLSAPlus-Subscription-Limit-Bytes', String(DAILY_EGRESS_LIMIT_BYTES));
    headers.set('X-WLSAPlus-Subscription-Remaining-Bytes', String(quota.remaining));
    headers.set('X-WLSAPlus-Daily-Limit-Bytes', String(DAILY_EGRESS_LIMIT_BYTES));
    if (providerUsage) {
      headers.set('X-WLSAPlus-Daily-Usage-Bytes', String(providerQuota.usageBytes));
      headers.set('X-WLSAPlus-Daily-Remaining-Bytes', String(providerQuota.remaining));
      headers.set('X-WLSAPlus-Usage-Source', 'subscription-userinfo');
    }
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    return new Response(payload, { status: 200, headers });
  },
};

export class DailyQuota extends DurableObject {
  async fetch(request) {
    const pathname = new URL(request.url).pathname;
    if ((request.method !== 'POST' || !['/reserve', '/provider-usage'].includes(pathname)) &&
      (request.method !== 'GET' || pathname !== '/status')) {
      return new Response('Not found', { status: 404 });
    }

    if (request.method === 'GET' && pathname === '/status') {
      const saved = await this.ctx.storage.get('daily');
      const date = utcDay();
      const bytes = saved?.date === date && Number.isSafeInteger(saved.bytes) ? saved.bytes : 0;
      return Response.json({ allowed: bytes < DAILY_EGRESS_LIMIT_BYTES, remaining: DAILY_EGRESS_LIMIT_BYTES - bytes }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    let input;
    try {
      input = await request.json();
    } catch {
      return new Response('Invalid request', { status: 400 });
    }
    const date = String(input?.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Invalid quota reservation', { status: 400 });

    if (pathname === '/provider-usage') {
      const rawTotal = String(input?.totalBytes || '');
      if (!/^\d+$/.test(rawTotal)) return new Response('Invalid provider usage', { status: 400 });
      let totalBytes;
      try { totalBytes = BigInt(rawTotal); } catch { return new Response('Invalid provider usage', { status: 400 }); }

      const result = await this.ctx.blockConcurrencyWhile(async () => {
        const saved = await this.ctx.storage.get('provider');
        const previousTotal = saved?.totalBytes && /^\d+$/.test(String(saved.totalBytes)) ? BigInt(saved.totalBytes) : null;
        const previousDaily = saved?.date === date && saved?.dailyBytes && /^\d+$/.test(String(saved.dailyBytes))
          ? BigInt(saved.dailyBytes)
          : (previousTotal !== null && totalBytes >= previousTotal ? totalBytes - previousTotal : 0n);
        const increment = previousTotal !== null && totalBytes >= previousTotal ? totalBytes - previousTotal : 0n;
        const usage = saved?.date === date ? previousDaily + increment : previousDaily;
        const cappedUsage = usage > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : usage;
        await this.ctx.storage.put('provider', {
          date,
          totalBytes: totalBytes.toString(),
          dailyBytes: usage.toString(),
        });
        const limit = BigInt(DAILY_EGRESS_LIMIT_BYTES);
        return {
          allowed: usage < limit,
          usageBytes: Number(cappedUsage),
          remaining: Number(usage >= limit ? 0n : limit - usage),
        };
      });
      return Response.json(result, { status: result.allowed ? 200 : 429, headers: { 'Cache-Control': 'no-store' } });
    }

    const bytes = Number(input?.bytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > DAILY_EGRESS_LIMIT_BYTES) {
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
