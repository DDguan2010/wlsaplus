const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildMacVpnStartScript, buildMacVpnStopScript, privilegedAppleScript, shellQuote } = require('./mac-vpn.cjs');

test('quotes shell paths without allowing command substitution', () => {
  assert.equal(shellQuote("/tmp/a'b $(touch bad)"), "'/tmp/a'\"'\"'b $(touch bad)'");
});

test('builds a detached macOS VPN launch with a protected pid file', () => {
  const script = buildMacVpnStartScript({
    core: '/Applications/WLSAPlus.app/Contents/Resources/vpn-core/sing-box',
    config: '/Users/student/Library/Application Support/WLSAPlus/vpn/config.json',
    pidFile: '/Users/student/Library/Application Support/WLSAPlus/vpn/sing-box.pid',
    logFile: '/Users/student/Library/Application Support/WLSAPlus/vpn/sing-box.log',
  });

  assert.match(script, /umask 077/);
  assert.match(script, /export PATH='\/Applications\/WLSAPlus\.app\/Contents\/Resources\/vpn-core:/);
  assert.match(script, /nohup .*sing-box' run -c/);
  assert.match(script, /> .*sing-box\.log' 2>&1 < \/dev\/null &/);
  assert.match(script, /echo \$! >/);
});

test('builds a bounded macOS VPN stop command and escaped AppleScript', () => {
  const stop = buildMacVpnStopScript('/tmp/wlsa vpn/pid');
  assert.match(stop, /kill "\$vpn_pid"/);
  assert.match(stop, /kill -9 "\$vpn_pid"/);
  assert.match(stop, /rm -f '\/tmp\/wlsa vpn\/pid'/);
  assert.equal(privilegedAppleScript('echo "ok"'), 'do shell script "echo \\"ok\\"" with administrator privileges');
});
