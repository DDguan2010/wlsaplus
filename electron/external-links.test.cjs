const test = require('node:test');
const assert = require('node:assert/strict');
const { validateExternalHelpUrl } = require('./external-links.cjs');

test('allows the bundled WLSAPlus help articles', () => {
  assert.equal(
    validateExternalHelpUrl('https://wlsaplus.02studio.xyz/blog/set-up-phone-control-on-windows/'),
    'https://wlsaplus.02studio.xyz/blog/set-up-phone-control-on-windows/',
  );
});

test('rejects arbitrary external URLs', () => {
  assert.throws(() => validateExternalHelpUrl('https://example.com/'), /not allowed/);
  assert.throws(() => validateExternalHelpUrl('javascript:alert(1)'), /not allowed/);
});
