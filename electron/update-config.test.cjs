const assert = require('node:assert/strict');
const test = require('node:test');
const { UPDATE_MIRROR_BASE_URL, updateFeed } = require('./update-config.cjs');

test('uses the release accelerator as the primary update feed', () => {
  assert.deepEqual(updateFeed(), {
    provider: 'generic',
    url: UPDATE_MIRROR_BASE_URL,
    useMultipleRangeRequest: false,
  });
  assert.equal(
    new URL('latest.yml', `${UPDATE_MIRROR_BASE_URL}/`).href,
    'https://gh-proxy.com/https://github.com/DDguan2010/wlsaplus/releases/latest/download/latest.yml',
  );
});

test('keeps GitHub as the update fallback', () => {
  assert.deepEqual(updateFeed('github'), {
    provider: 'github',
    owner: 'DDguan2010',
    repo: 'wlsaplus',
  });
  assert.throws(() => updateFeed('unknown'), /Unknown update feed/);
});
