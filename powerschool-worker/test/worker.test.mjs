import assert from 'node:assert/strict';
import test from 'node:test';
import worker, {
  applySetCookies,
  buildCookieHeader,
  createUpstreamUrl,
  getSetCookieHeaders,
  isAllowedUpstreamPath,
} from '../src/worker.js';

test('allows only configured PowerSchool paths', () => {
  assert.equal(isAllowedUpstreamPath('/public/'), true);
  assert.equal(isAllowedUpstreamPath('/guardian/myschedule.html'), true);
  assert.equal(isAllowedUpstreamPath('/admin/home.html'), false);
  assert.equal(isAllowedUpstreamPath('//example.com/guardian/home.html'), false);
  assert.equal(isAllowedUpstreamPath('/guardian/%2e%2e/admin'), false);
});

test('always creates an URL on the fixed PowerSchool origin', () => {
  const url = createUpstreamUrl('/guardian/myschedule.html?week=1');
  assert.equal(url.origin, 'https://ps.wlsash.org.cn');
  assert.equal(url.pathname, '/guardian/myschedule.html');
  assert.equal(url.search, '?week=1');
  assert.throws(() => createUpstreamUrl('//example.com/guardian/home.html'));
});

test('stores and selects upstream cookies by path', () => {
  const now = Date.UTC(2026, 8, 3);
  const loginUrl = new URL('https://ps.wlsash.org.cn/guardian/home.html');
  const jar = applySetCookies([], [
    'JSESSIONID=abc123; Path=/; Secure; HttpOnly',
    'guardian=value; Path=/guardian; Max-Age=60',
  ], loginUrl, now);

  assert.equal(
    buildCookieHeader(jar, new URL('https://ps.wlsash.org.cn/guardian/myschedule.html'), now),
    'guardian=value; JSESSIONID=abc123',
  );
  assert.equal(
    buildCookieHeader(jar, new URL('https://ps.wlsash.org.cn/public/'), now),
    'JSESSIONID=abc123',
  );
});

test('handles combined Set-Cookie values containing an Expires comma', () => {
  const headers = new Headers({
    'set-cookie': 'first=1; Expires=Wed, 09 Jun 2030 10:18:14 GMT, second=2; Path=/',
  });
  assert.deepEqual(getSetCookieHeaders(headers), [
    'first=1; Expires=Wed, 09 Jun 2030 10:18:14 GMT',
    'second=2; Path=/',
  ]);
});

test('edge handler applies CORS and forwards a safe path to the session object', async () => {
  let forwardedRequest;
  const sessionStub = {
    async fetch(input, init) {
      forwardedRequest = new Request(input, init);
      return new Response('<html>schedule</html>', {
        headers: { 'content-type': 'text/html' },
      });
    },
  };
  const env = {
    POWERSCHOOL_SESSIONS: {
      idFromName: (name) => name,
      get: () => sessionStub,
    },
  };
  const request = new Request(
    'https://apiwlsaplus.02studio.xyz/api/powerschool/guardian/myschedule.html?week=1',
    { headers: { origin: 'https://wlsa.02studio.xyz' } },
  );

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://wlsa.02studio.xyz');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Strict/);
  const internalUrl = new URL(forwardedRequest.url);
  assert.equal(
    internalUrl.searchParams.get('path'),
    '/guardian/myschedule.html?week=1',
  );
});

test('edge handler forwards POST bodies and content types', async () => {
  let forwardedRequest;
  const sessionStub = {
    async fetch(input, init) {
      forwardedRequest = new Request(input, init);
      return new Response('ok', { status: 200 });
    },
  };
  const env = {
    POWERSCHOOL_SESSIONS: {
      idFromName: (name) => name,
      get: () => sessionStub,
    },
  };
  const request = new Request(
    'https://apiwlsaplus.02studio.xyz/api/powerschool/guardian/home.html',
    {
      method: 'POST',
      headers: {
        origin: 'https://wlsa.02studio.xyz',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'account=student&pw=secret',
    },
  );

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 200);
  assert.equal(forwardedRequest.method, 'POST');
  assert.equal(forwardedRequest.headers.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(await forwardedRequest.text(), 'account=student&pw=secret');
});

test('edge handler rejects unknown origins before allocating a session', async () => {
  let allocated = false;
  const env = {
    POWERSCHOOL_SESSIONS: {
      idFromName: () => {
        allocated = true;
      },
    },
  };
  const request = new Request(
    'https://apiwlsaplus.02studio.xyz/api/powerschool/public/',
    { headers: { origin: 'https://attacker.example' } },
  );

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 403);
  assert.equal(allocated, false);
});
