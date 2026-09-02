const VPN_CONNECTION_MODES = new Set(['system-proxy', 'full-tunnel']);

function buildShadowsocksOutbound(profile) {
  const outbound = {
    type: 'shadowsocks',
    tag: '02vpn',
    server: profile.server,
    server_port: profile.serverPort,
    method: profile.method,
    password: profile.password,
  };
  if (profile.plugin) outbound.plugin = profile.plugin;
  if (profile.pluginOptions) outbound.plugin_opts = profile.pluginOptions;
  return outbound;
}

function buildVpnConfig(profile, mode, proxyPort) {
  if (!VPN_CONNECTION_MODES.has(mode)) throw new Error(`Unsupported VPN mode: ${mode}`);
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65_535) throw new Error('Invalid local proxy port.');

  const mixedInbound = { type: 'mixed', tag: 'local-proxy', listen: '127.0.0.1', listen_port: proxyPort };
  const config = {
    log: { level: 'warn', timestamp: true },
    inbounds: [mixedInbound],
    outbounds: [buildShadowsocksOutbound(profile)],
    route: { auto_detect_interface: true, final: '02vpn' },
  };

  if (mode === 'full-tunnel') {
    config.dns = {
      servers: [{
        type: 'https',
        tag: 'tunnel-dns',
        server: '1.1.1.1',
        server_port: 443,
        path: '/dns-query',
        tls: { enabled: true, server_name: 'cloudflare-dns.com' },
        detour: '02vpn',
      }],
      final: 'tunnel-dns',
      strategy: 'ipv4_only',
    };
    config.inbounds.unshift({
      type: 'tun',
      tag: 'full-tunnel',
      interface_name: 'WLSAPlus',
      address: ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'],
      mtu: 1500,
      auto_route: true,
      strict_route: true,
      stack: 'mixed',
    });
    config.route.rules = [{
      inbound: ['full-tunnel'],
      network: ['tcp', 'udp'],
      port: 53,
      action: 'hijack-dns',
    }];
    config.route.default_domain_resolver = 'tunnel-dns';
  }

  return config;
}

module.exports = { VPN_CONNECTION_MODES, buildVpnConfig };
