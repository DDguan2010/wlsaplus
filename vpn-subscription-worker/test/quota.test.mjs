import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const source = (await readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  .replace("import { DurableObject } from 'cloudflare:workers';", `
    class DurableObject {
      constructor(ctx, env) { this.ctx = ctx; this.env = env; }
    }
  `);
const { default: worker, DailyQuota, DAILY_EGRESS_LIMIT_BYTES } = await import(
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
);

function createQuota() {
  const data = new Map();
  let lock = Promise.resolve();
  const ctx = {
    storage: {
      get: async key => data.get(key),
      put: async (key, value) => data.set(key, value),
    },
    blockConcurrencyWhile(callback) {
      const previous = lock;
      let unlock;
      lock = new Promise(resolve => { unlock = resolve; });
      return previous.then(callback).finally(unlock);
    },
  };
  const quota = new DailyQuota(ctx, {});
  return { quota, data };
}

function reserve(quota, date, bytes) {
  return quota.fetch(new Request('https://quota.internal/reserve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, bytes }),
  }));
}

test('the shared quota counts exact bytes and rolls over by UTC day', async () => {
  const { quota, data } = createQuota();
  const first = await reserve(quota, '2026-10-19', 8);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { allowed: true, remaining: DAILY_EGRESS_LIMIT_BYTES - 8 });

  const last = await reserve(quota, '2026-10-19', DAILY_EGRESS_LIMIT_BYTES - 8);
  assert.equal(last.status, 200);
  assert.deepEqual(await last.json(), { allowed: true, remaining: 0 });

  assert.equal((await reserve(quota, '2026-10-19', 1)).status, 429);
  const nextDay = await reserve(quota, '2026-10-20', 1);
  assert.equal(nextDay.status, 200);
  assert.deepEqual(await nextDay.json(), { allowed: true, remaining: DAILY_EGRESS_LIMIT_BYTES - 1 });
  assert.deepEqual(data.get('daily'), { date: '2026-10-20', bytes: 1 });
});

test('concurrent reservations cannot exceed the daily limit', async () => {
  const { quota, data } = createQuota();
  data.set('daily', { date: '2026-10-19', bytes: DAILY_EGRESS_LIMIT_BYTES - 5 });

  const results = await Promise.all([
    reserve(quota, '2026-10-19', 4),
    reserve(quota, '2026-10-19', 4),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 429]);
  assert.equal(data.get('daily').bytes, DAILY_EGRESS_LIMIT_BYTES - 1);
});

test('the subscription endpoint counts response bytes before returning them', async t => {
  const { quota, data } = createQuota();
  const date = new Date().toISOString().slice(0, 10);
  data.set('daily', { date, bytes: DAILY_EGRESS_LIMIT_BYTES - 5 });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('12345', {
    headers: { 'Content-Type': 'text/plain' },
  });
  t.after(() => { globalThis.fetch = originalFetch; });

  const env = {
    UPSTREAM_SUBSCRIPTION_URL: 'https://upstream.example/subscribe',
    SUBSCRIPTION_QUOTA: {
      idFromName: name => name,
      get: () => ({ fetch: (input, init) => quota.fetch(new Request(input, init)) }),
    },
  };
  const request = () => worker.fetch(new Request('https://worker.example/api/subscribe?format=ss'), env);

  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Length'), '5');
  assert.equal(response.headers.get('X-WLSAPlus-Daily-Remaining-Bytes'), '0');
  assert.equal(await response.text(), '12345');

  const rejected = await request();
  assert.equal(rejected.status, 429);
  assert.equal(data.get('daily').bytes, DAILY_EGRESS_LIMIT_BYTES);
});

test('invalid reservations are rejected without changing usage', async () => {
  const { quota, data } = createQuota();
  for (const body of [{ date: 'today', bytes: 1 }, { date: '2026-10-19', bytes: -1 }]) {
    const response = await quota.fetch(new Request('https://quota.internal/reserve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    assert.equal(response.status, 400);
  }
  assert.equal(data.size, 0);
});
