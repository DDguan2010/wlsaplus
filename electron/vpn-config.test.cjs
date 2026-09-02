const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { buildVpnConfig } = require('./vpn-config.cjs');

const PROFILE = {
  server: '203.0.113.1',
  serverPort: 443,
  method: 'aes-128-gcm',
  password: 'test-password',
};

test('system proxy mode only exposes the local mixed proxy', () => {
  const config = buildVpnConfig(PROFILE, 'system-proxy', 17890);

  assert.deepEqual(config.inbounds, [{ type: 'mixed', tag: 'local-proxy', listen: '127.0.0.1', listen_port: 17890 }]);
  assert.equal(config.dns, undefined);
  assert.equal(config.route.final, '02vpn');
});

test('full tunnel mode captures system routes and DNS', () => {
  const config = buildVpnConfig(PROFILE, 'full-tunnel', 17890);
  const tun = config.inbounds.find((inbound) => inbound.type === 'tun');

  assert.equal(tun.auto_route, true);
  assert.equal(tun.strict_route, true);
  assert.deepEqual(tun.address, ['172.19.0.1/30', 'fdfe:dcba:9876::1/126']);
  assert.deepEqual(config.route.rules, [{
    inbound: ['full-tunnel'],
    network: ['tcp', 'udp'],
    port: 53,
    action: 'hijack-dns',
  }]);
  assert.equal(config.dns.servers[0].detour, '02vpn');
});

test('sing-box accepts the generated full tunnel configuration', { skip: process.platform !== 'win32' }, (context) => {
  const executable = path.join(__dirname, '..', 'build', 'vpn-core', 'sing-box.exe');
  if (!fs.existsSync(executable)) return context.skip('sing-box is not available');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wlsaplus-vpn-config-'));
  const configFile = path.join(directory, 'config.json');
  try {
    fs.writeFileSync(configFile, JSON.stringify(buildVpnConfig(PROFILE, 'full-tunnel', 17890)));
    const result = spawnSync(executable, ['check', '-c', configFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
