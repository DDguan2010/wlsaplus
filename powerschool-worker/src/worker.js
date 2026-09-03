const API_PREFIX = '/api/powerschool';
const UPSTREAM_ORIGIN = 'https://ps.wlsash.org.cn';
const SESSION_COOKIE = '__Host-wlsaplus_ps';
const DEFAULT_ALLOWED_ORIGINS = ['https://wlsa.02studio.xyz'];
const DEFAULT_ALLOWED_PATH_PREFIXES = ['/public/', '/guardian/'];
const DEFAULT_ALLOWED_METHODS = ['GET', 'HEAD', 'POST'];
const DEFAULT_SESSION_TTL_SECONDS = 30 * 60;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_REQUESTS_PER_MINUTE = 120;
const MAX_REDIRECTS = 5;

const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'x-requested-with',
];

const FORWARDED_RESPONSE_HEADERS = [
  'cache-control',
  'content-language',
  'content-type',
  'etag',
  'expires',
  'last-modified',
];

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);

    if (requestUrl.pathname === '/health' && request.method === 'GET') {
      return Response.json({ ok: true });
    }

    const origin = getAllowedOrigin(request, env);
    if (!origin) return jsonError('Origin is not allowed.', 403);

    if (request.method === 'OPTIONS') {
      return corsPreflight(origin, env);
    }

    if (!requestUrl.pathname.startsWith(`${API_PREFIX}/`)) {
      return withCors(jsonError('Not found.', 404), origin, env);
    }

    if (!env.POWERSCHOOL_SESSIONS) {
      return withCors(jsonError('Session storage is not configured.', 500), origin, env);
    }

    const cookies = parseCookieHeader(request.headers.get('cookie'));
    const existingSessionId = cookies.get(SESSION_COOKIE);
    const sessionId = isSessionId(existingSessionId) ? existingSessionId : crypto.randomUUID();
    const hasExistingSession = sessionId === existingSessionId;
    const sessionStub = env.POWERSCHOOL_SESSIONS.get(
      env.POWERSCHOOL_SESSIONS.idFromName(sessionId),
    );

    if (requestUrl.pathname === `${API_PREFIX}/logout`) {
      if (request.method !== 'POST' && request.method !== 'DELETE') {
        return withCors(methodNotAllowed(['POST', 'DELETE']), origin, env);
      }
      if (hasExistingSession) {
        await sessionStub.fetch('https://session.internal/logout', { method: 'POST' });
      }
      const response = new Response(null, { status: 204 });
      return withCors(response, origin, env, expiredSessionCookie());
    }

    const allowedMethods = getCsvSetting(env.ALLOWED_METHODS, DEFAULT_ALLOWED_METHODS)
      .map((method) => method.toUpperCase());
    if (!allowedMethods.includes(request.method)) {
      return withCors(methodNotAllowed(allowedMethods), origin, env);
    }

    const upstreamPath = requestUrl.pathname.slice(API_PREFIX.length);
    const allowedPrefixes = getCsvSetting(
      env.ALLOWED_PATH_PREFIXES,
      DEFAULT_ALLOWED_PATH_PREFIXES,
    );
    if (!isAllowedUpstreamPath(upstreamPath, allowedPrefixes)) {
      return withCors(jsonError('PowerSchool path is not allowed.', 403), origin, env);
    }

    const maxRequestBytes = getPositiveInteger(
      env.MAX_REQUEST_BYTES,
      DEFAULT_MAX_REQUEST_BYTES,
    );
    const declaredLength = Number(request.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxRequestBytes) {
      return withCors(jsonError('Request body is too large.', 413), origin, env);
    }

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
      if (body.byteLength > maxRequestBytes) {
        return withCors(jsonError('Request body is too large.', 413), origin, env);
      }
    }

    const internalUrl = new URL('https://session.internal/proxy');
    internalUrl.searchParams.set('path', `${upstreamPath}${requestUrl.search}`);
    const internalHeaders = copyHeaders(request.headers, FORWARDED_REQUEST_HEADERS);

    let upstreamResponse;
    try {
      upstreamResponse = await sessionStub.fetch(internalUrl, {
        method: request.method,
        headers: internalHeaders,
        body,
      });
    } catch {
      upstreamResponse = jsonError('PowerSchool gateway did not respond.', 502);
    }

    const ttl = getPositiveInteger(env.SESSION_TTL_SECONDS, DEFAULT_SESSION_TTL_SECONDS);
    return withCors(upstreamResponse, origin, env, activeSessionCookie(sessionId, ttl));
  },
};

export class PowerSchoolSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    const operation = this.queue.then(() => this.handleRequest(request));
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async alarm() {
    const lastAccess = await this.state.storage.get('lastAccess');
    if (!lastAccess) {
      await this.state.storage.deleteAll();
      return;
    }

    const ttlMs = getPositiveInteger(
      this.env.SESSION_TTL_SECONDS,
      DEFAULT_SESSION_TTL_SECONDS,
    ) * 1000;
    const expiresAt = lastAccess + ttlMs;
    if (Date.now() >= expiresAt) {
      await this.state.storage.deleteAll();
      return;
    }
    await this.state.storage.setAlarm(expiresAt);
  }

  async handleRequest(request) {
    const url = new URL(request.url);
    if (url.pathname === '/logout' && request.method === 'POST') {
      await this.state.storage.deleteAll();
      return new Response(null, { status: 204 });
    }

    if (url.pathname !== '/proxy') return jsonError('Not found.', 404);

    const rateLimitResponse = await this.applyRateLimit();
    if (rateLimitResponse) return rateLimitResponse;

    const now = Date.now();
    const ttlMs = getPositiveInteger(
      this.env.SESSION_TTL_SECONDS,
      DEFAULT_SESSION_TTL_SECONDS,
    ) * 1000;
    const lastAccess = await this.state.storage.get('lastAccess');
    let cookieJar = (await this.state.storage.get('cookieJar')) ?? [];
    if (lastAccess && now - lastAccess > ttlMs) cookieJar = [];

    const pathAndSearch = url.searchParams.get('path');
    const allowedPrefixes = getCsvSetting(
      this.env.ALLOWED_PATH_PREFIXES,
      DEFAULT_ALLOWED_PATH_PREFIXES,
    );
    let upstreamUrl;
    try {
      upstreamUrl = createUpstreamUrl(pathAndSearch, allowedPrefixes);
    } catch {
      return jsonError('PowerSchool path is not allowed.', 403);
    }

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      body = await request.arrayBuffer();
    }

    try {
      const result = await fetchPowerSchool({
        url: upstreamUrl,
        method: request.method,
        headers: request.headers,
        body,
        cookieJar,
        allowedPrefixes,
      });
      cookieJar = result.cookieJar;
      await this.state.storage.put({ cookieJar, lastAccess: now });
      await this.state.storage.setAlarm(now + ttlMs);
      return await toBrowserResponse(result.response, this.env);
    } catch (error) {
      const status = error instanceof ResponseTooLargeError ? 502 : 502;
      const message = error instanceof ResponseTooLargeError
        ? 'PowerSchool returned a response that was too large.'
        : 'Could not reach PowerSchool.';
      return jsonError(message, status);
    }
  }

  async applyRateLimit() {
    const now = Date.now();
    const limit = getPositiveInteger(
      this.env.SESSION_REQUESTS_PER_MINUTE,
      DEFAULT_REQUESTS_PER_MINUTE,
    );
    let rate = await this.state.storage.get('rate');
    if (!rate || now - rate.startedAt >= 60_000) {
      rate = { startedAt: now, count: 0 };
    }
    rate.count += 1;
    await this.state.storage.put('rate', rate);
    if (rate.count <= limit) return null;

    const retryAfter = Math.max(1, Math.ceil((rate.startedAt + 60_000 - now) / 1000));
    return new Response(JSON.stringify({ error: 'Too many PowerSchool requests.' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(retryAfter),
      },
    });
  }
}

async function fetchPowerSchool({ url, method, headers, body, cookieJar, allowedPrefixes }) {
  let currentUrl = url;
  let currentMethod = method;
  let currentBody = body;
  let redirects = 0;

  while (true) {
    const upstreamHeaders = copyHeaders(headers, FORWARDED_REQUEST_HEADERS);
    const cookieHeader = buildCookieHeader(cookieJar, currentUrl);
    if (cookieHeader) upstreamHeaders.set('cookie', cookieHeader);
    if (currentMethod === 'GET' || currentMethod === 'HEAD') {
      upstreamHeaders.delete('content-type');
      currentBody = undefined;
    }

    const response = await fetch(currentUrl, {
      method: currentMethod,
      headers: upstreamHeaders,
      body: currentBody,
      redirect: 'manual',
    });

    cookieJar = applySetCookies(
      cookieJar,
      getSetCookieHeaders(response.headers),
      currentUrl,
      Date.now(),
    );

    if (!isRedirect(response.status) || !response.headers.has('location')) {
      return { response, cookieJar };
    }
    if (redirects >= MAX_REDIRECTS) throw new Error('Too many redirects.');

    const redirectedUrl = new URL(response.headers.get('location'), currentUrl);
    if (redirectedUrl.origin !== UPSTREAM_ORIGIN
      || !isAllowedUpstreamPath(redirectedUrl.pathname, allowedPrefixes)) {
      throw new Error('PowerSchool redirected outside the allowed routes.');
    }

    if (response.status === 303
      || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
      currentMethod = 'GET';
      currentBody = undefined;
    }
    currentUrl = redirectedUrl;
    redirects += 1;
  }
}

async function toBrowserResponse(upstreamResponse, env) {
  const maxBytes = getPositiveInteger(env.MAX_RESPONSE_BYTES, DEFAULT_MAX_RESPONSE_BYTES);
  const declaredLength = Number(upstreamResponse.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new ResponseTooLargeError();
  }

  const hasNoBody = [204, 205, 304].includes(upstreamResponse.status);
  let body = null;
  if (!hasNoBody) {
    body = await upstreamResponse.arrayBuffer();
    if (body.byteLength > maxBytes) throw new ResponseTooLargeError();
  }

  return new Response(body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: copyHeaders(upstreamResponse.headers, FORWARDED_RESPONSE_HEADERS),
  });
}

class ResponseTooLargeError extends Error {}

export function createUpstreamUrl(pathAndSearch, allowedPrefixes = DEFAULT_ALLOWED_PATH_PREFIXES) {
  if (typeof pathAndSearch !== 'string') throw new Error('Missing path.');
  const questionMark = pathAndSearch.indexOf('?');
  const path = questionMark === -1 ? pathAndSearch : pathAndSearch.slice(0, questionMark);
  if (!isAllowedUpstreamPath(path, allowedPrefixes)) throw new Error('Path is not allowed.');
  const url = new URL(pathAndSearch, `${UPSTREAM_ORIGIN}/`);
  if (url.origin !== UPSTREAM_ORIGIN) throw new Error('Origin is not allowed.');
  return url;
}

export function isAllowedUpstreamPath(path, allowedPrefixes = DEFAULT_ALLOWED_PATH_PREFIXES) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return false;
  if (!/^[A-Za-z0-9/_.~-]+$/.test(path)) return false;
  if (path.split('/').some((segment) => segment === '..' || segment === '.')) return false;
  return allowedPrefixes.some((prefix) => {
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    return path === normalized.slice(0, -1) || path.startsWith(normalized);
  });
}

export function getSetCookieHeaders(headers) {
  const values = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);
  return values.flatMap((value) => (
    value.split(/,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/)
  )).map((value) => value.trim());
}

export function applySetCookies(cookieJar, setCookieHeaders, requestUrl, now = Date.now()) {
  const nextJar = cookieJar.filter((cookie) => cookie.expiresAt === null || cookie.expiresAt > now);
  for (const header of setCookieHeaders) {
    const parsed = parseSetCookie(header, requestUrl, now);
    if (!parsed) continue;
    const index = nextJar.findIndex((cookie) => cookie.name === parsed.name
      && cookie.domain === parsed.domain
      && cookie.path === parsed.path);
    if (index !== -1) nextJar.splice(index, 1);
    if (parsed.expiresAt === null || parsed.expiresAt > now) nextJar.push(parsed);
  }
  return nextJar;
}

export function buildCookieHeader(cookieJar, requestUrl, now = Date.now()) {
  return cookieJar
    .filter((cookie) => (cookie.expiresAt === null || cookie.expiresAt > now)
      && domainMatches(requestUrl.hostname, cookie)
      && pathMatches(requestUrl.pathname, cookie.path)
      && (!cookie.secure || requestUrl.protocol === 'https:'))
    .sort((left, right) => right.path.length - left.path.length)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

function parseSetCookie(header, requestUrl, now) {
  const parts = header.split(';');
  const separator = parts[0].indexOf('=');
  if (separator <= 0) return null;

  const name = parts[0].slice(0, separator).trim();
  const value = parts[0].slice(separator + 1).trim();
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) return null;

  let domain = requestUrl.hostname.toLowerCase();
  let hostOnly = true;
  let path = defaultCookiePath(requestUrl.pathname);
  let secure = false;
  let expires = null;
  let maxAge = null;

  for (const rawAttribute of parts.slice(1)) {
    const attribute = rawAttribute.trim();
    const equals = attribute.indexOf('=');
    const key = (equals === -1 ? attribute : attribute.slice(0, equals)).trim().toLowerCase();
    const attributeValue = equals === -1 ? '' : attribute.slice(equals + 1).trim();
    if (key === 'domain') {
      const candidate = attributeValue.replace(/^\./, '').toLowerCase();
      if (!candidate || (requestUrl.hostname !== candidate
        && !requestUrl.hostname.endsWith(`.${candidate}`))) return null;
      domain = candidate;
      hostOnly = false;
    } else if (key === 'path' && attributeValue.startsWith('/')) {
      path = attributeValue;
    } else if (key === 'secure') {
      secure = true;
    } else if (key === 'max-age' && /^-?\d+$/.test(attributeValue)) {
      maxAge = Number(attributeValue);
    } else if (key === 'expires') {
      const timestamp = Date.parse(attributeValue);
      if (Number.isFinite(timestamp)) expires = timestamp;
    }
  }

  const expiresAt = maxAge === null ? expires : now + (maxAge * 1000);
  return { name, value, domain, hostOnly, path, secure, expiresAt };
}

function defaultCookiePath(pathname) {
  if (!pathname.startsWith('/') || pathname === '/') return '/';
  const finalSlash = pathname.lastIndexOf('/');
  return finalSlash <= 0 ? '/' : pathname.slice(0, finalSlash);
}

function domainMatches(hostname, cookie) {
  if (cookie.hostOnly) return hostname === cookie.domain;
  return hostname === cookie.domain || hostname.endsWith(`.${cookie.domain}`);
}

function pathMatches(pathname, cookiePath) {
  if (pathname === cookiePath) return true;
  if (!pathname.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || pathname.charAt(cookiePath.length) === '/';
}

function parseCookieHeader(header) {
  const cookies = new Map();
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function copyHeaders(source, names) {
  const result = new Headers();
  for (const name of names) {
    const value = source.get(name);
    if (value !== null) result.set(name, value);
  }
  return result;
}

function getAllowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const allowed = getCsvSetting(env.ALLOWED_ORIGINS, DEFAULT_ALLOWED_ORIGINS);
  return allowed.includes(origin) ? origin : null;
}

function getCsvSetting(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return [...fallback];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function getPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isSessionId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function activeSessionCookie(sessionId, ttlSeconds) {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; Max-Age=${ttlSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

function expiredSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function corsPreflight(origin, env) {
  const methods = getCsvSetting(env.ALLOWED_METHODS, DEFAULT_ALLOWED_METHODS)
    .map((method) => method.toUpperCase());
  methods.push('OPTIONS');
  return withCors(new Response(null, { status: 204 }), origin, env, null, methods);
}

function withCors(response, origin, env, setCookie = null, methodsOverride = null) {
  const headers = new Headers(response.headers);
  const methods = methodsOverride ?? getCsvSetting(env.ALLOWED_METHODS, DEFAULT_ALLOWED_METHODS)
    .map((method) => method.toUpperCase());
  headers.set('access-control-allow-origin', origin);
  headers.set('access-control-allow-credentials', 'true');
  headers.set('access-control-allow-methods', [...new Set([...methods, 'POST', 'DELETE', 'OPTIONS'])].join(', '));
  headers.set('access-control-allow-headers', 'Accept, Content-Type, X-Requested-With');
  headers.set('access-control-max-age', '86400');
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.append('vary', 'Origin');
  if (setCookie) headers.append('set-cookie', setCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function methodNotAllowed(methods) {
  return new Response(JSON.stringify({ error: 'Method is not allowed.' }), {
    status: 405,
    headers: {
      allow: methods.join(', '),
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
