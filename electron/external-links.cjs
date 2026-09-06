const EXTERNAL_HELP_URLS = new Set([
  'https://wlsaplus.02studio.xyz/blog/set-up-phone-control-on-windows/',
  'https://wlsaplus.02studio.xyz/blog/use-wechat-on-restricted-networks/',
]);

function validateExternalHelpUrl(value) {
  if (typeof value !== 'string' || !EXTERNAL_HELP_URLS.has(value)) {
    throw new Error('External help URL is not allowed.');
  }
  return value;
}

module.exports = { validateExternalHelpUrl };
