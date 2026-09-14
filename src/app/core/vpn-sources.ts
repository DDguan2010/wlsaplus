export interface VpnSource {
  id: string;
  name: string;
  description: string;
  endpoint: string;
}

// Only proxy endpoints belong in the client. The upstream subscription is a
// Worker secret and must never be copied into this source file.
export const VPN_SOURCES: readonly VpnSource[] = [
  {
    id: 'relay',
    name: 'WLSAPlus relay',
    description: 'The new shared relay endpoint.',
    endpoint: 'https://vpnrelay.02studio.xyz/api/subscribe',
  },
];

export function vpnSource(id: string): VpnSource {
  return VPN_SOURCES.find((source) => source.id === id) ?? VPN_SOURCES[0];
}
