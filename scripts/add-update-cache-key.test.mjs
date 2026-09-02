import assert from 'node:assert/strict';
import test from 'node:test';
import { addUpdateCacheKey } from './add-update-cache-key.mjs';

test('adds a stable build key to update files and the legacy path', () => {
  const metadata = addUpdateCacheKey({
    version: '1.0.3',
    files: [{ url: 'WLSAPlus-1.0.3-Windows-Setup.exe', sha512: 'test' }],
    path: 'WLSAPlus-1.0.3-Windows-Setup.exe',
  }, '33624683714-1');

  assert.equal(metadata.files[0].url, 'WLSAPlus-1.0.3-Windows-Setup.exe?build=33624683714-1');
  assert.equal(metadata.path, 'WLSAPlus-1.0.3-Windows-Setup.exe?build=33624683714-1');
  assert.equal(metadata.files[0].sha512, 'test');
});

test('rejects malformed metadata and unsafe cache keys', () => {
  assert.throws(() => addUpdateCacheKey({}, '123'), /does not contain files/);
  assert.throws(() => addUpdateCacheKey({ files: [{ url: 'setup.exe' }] }, 'bad key'), /must contain only/);
});
