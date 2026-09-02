const UPDATE_MIRROR_BASE_URL = 'https://gh-proxy.com/https://github.com/DDguan2010/wlsaplus/releases/latest/download';

function updateFeed(source = 'mirror') {
  if (source === 'mirror') {
    return {
      provider: 'generic',
      url: UPDATE_MIRROR_BASE_URL,
      useMultipleRangeRequest: false,
    };
  }
  if (source === 'github') {
    return {
      provider: 'github',
      owner: 'DDguan2010',
      repo: 'wlsaplus',
    };
  }
  throw new Error(`Unknown update feed: ${source}`);
}

module.exports = { UPDATE_MIRROR_BASE_URL, updateFeed };
