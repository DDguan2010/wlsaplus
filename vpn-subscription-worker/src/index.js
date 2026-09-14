const ALLOWED_FORMATS = new Set(['clash', 'ss']);
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

    const headers = responseHeaders(request, env, upstreamResponse.headers.get('Content-Type') || 'text/plain; charset=utf-8');
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    return new Response(upstreamResponse.body, { status: 200, headers });
  },
};
