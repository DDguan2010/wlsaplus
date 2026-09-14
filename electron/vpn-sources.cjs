'use strict';

// These are public proxy endpoints. Keep upstream subscription URLs in Worker
// secrets; never put them in this file or in the packaged application.
const VPN_SOURCES = Object.freeze({
  relay: Object.freeze({
    id: 'relay',
    name: 'WLSAPlus relay',
    description: 'The new shared relay endpoint.',
    endpoint: 'https://vpnrelay.02studio.xyz/api/subscribe',
  }),
});

function getVpnSource(id) {
  return VPN_SOURCES[id] || VPN_SOURCES.relay;
}

function subscriptionUrl(sourceId, format = 'ss') {
  const source = getVpnSource(sourceId);
  const url = new URL(source.endpoint);
  url.searchParams.set('format', format);
  return url;
}

module.exports = { VPN_SOURCES, getVpnSource, subscriptionUrl };
