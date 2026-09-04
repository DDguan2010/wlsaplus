const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  PhoneManager,
  buildScrcpyArguments,
  isWirelessSerial,
  parseAdbDevices,
  parseWifiIpv4,
  phoneActionKeyCode,
} = require('./phone-manager.cjs');

test('parses authorized and unauthorized ADB devices', () => {
  const devices = parseAdbDevices(`List of devices attached
R5CT1234 device product:b0q model:SM_S9080 device:b0q transport_id:1
FA123 unauthorized usb:1-2 transport_id:2
192.168.50.17:5555 device product:oriole model:Pixel_6 transport_id:3
`);
  assert.deepEqual(devices.map(({ serial, state, model }) => ({ serial, state, model })), [
    { serial: 'R5CT1234', state: 'device', model: 'SM S9080' },
    { serial: 'FA123', state: 'unauthorized', model: '' },
    { serial: '192.168.50.17:5555', state: 'device', model: 'Pixel 6' },
  ]);
  assert.equal(isWirelessSerial(devices[0].serial), false);
  assert.equal(isWirelessSerial(devices[2].serial), true);
});

test('extracts only a private Wi-Fi IPv4 address', () => {
  assert.equal(parseWifiIpv4('default via 192.168.50.1 dev wlan0\n192.168.50.0/24 dev wlan0 src 192.168.50.17'), '192.168.50.17');
  assert.equal(parseWifiIpv4('2: wlan0 inet 10.20.30.40/24 brd 10.20.30.255 scope global wlan0'), '10.20.30.40');
  assert.equal(parseWifiIpv4('2: rmnet0 inet 8.8.8.8/32 scope global rmnet0'), null);
});

test('builds scrcpy arguments with screen-off mirroring enabled by default', () => {
  assert.deepEqual(buildScrcpyArguments('192.168.50.17:5555'), [
    '--serial', '192.168.50.17:5555',
    '--window-title', 'WLSAPlus Phone',
    '--keep-active',
    '--disable-screensaver',
    '--turn-screen-off',
  ]);
  assert.equal(buildScrcpyArguments('192.168.50.17:5555', { turnScreenOff: false }).includes('--turn-screen-off'), false);
});

test('allows only the fixed phone control actions', () => {
  assert.equal(phoneActionKeyCode('home'), '3');
  assert.equal(phoneActionKeyCode('power'), '26');
  assert.throws(() => phoneActionKeyCode('shell rm'), /Unsupported phone control action/);
});

test('configures USB ADB for Wi-Fi and verifies the wireless device', async () => {
  const calls = [];
  const exec = async (_executable, args) => {
    calls.push(args);
    const command = args.join(' ');
    if (command === 'devices -l') return { stdout: 'List of devices attached\nUSB123 device model:Pixel_8\n' };
    if (command.endsWith('getprop ro.product.model')) return { stdout: 'Pixel 8\n' };
    if (command.endsWith('getprop ro.build.version.release')) return { stdout: '15\n' };
    if (command.endsWith('getprop ro.build.version.sdk')) return { stdout: '35\n' };
    if (command.endsWith('shell ip route')) return { stdout: '192.168.1.0/24 dev wlan0 src 192.168.1.24\n' };
    if (command.endsWith('shell ip -o -4 addr show wlan0')) throw new Error('unsupported');
    if (command.endsWith('get-state')) return { stdout: 'device\n' };
    return { stdout: '' };
  };
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', exec });
  manager.launch = async (options) => manager.setStatus({ state: 'mirroring', message: 'test', screenOff: options.turnScreenOff !== false });

  const status = await manager.connect({ turnScreenOff: true });

  assert.equal(status.state, 'mirroring');
  assert.equal(manager.lastDevice.serial, '192.168.1.24:5555');
  assert.ok(calls.some((args) => args.join(' ') === '-s USB123 tcpip 5555'));
  assert.ok(calls.some((args) => args.join(' ') === 'connect 192.168.1.24:5555'));
  assert.ok(calls.some((args) => args.join(' ') === '-s 192.168.1.24:5555 get-state'));
});
