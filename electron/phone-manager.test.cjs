const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
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
  let tcpPort = '';
  const exec = async (_executable, args) => {
    calls.push(args);
    const command = args.join(' ');
    if (command === 'devices -l') return { stdout: 'List of devices attached\nUSB123 device model:Pixel_8\n' };
    if (command.endsWith('getprop ro.product.model')) return { stdout: 'Pixel 8\n' };
    if (command.endsWith('getprop ro.build.version.release')) return { stdout: '15\n' };
    if (command.endsWith('getprop ro.build.version.sdk')) return { stdout: '35\n' };
    if (command.endsWith('getprop service.adb.tcp.port')) return { stdout: tcpPort };
    if (command === '-s USB123 tcpip 5555') tcpPort = '5555';
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

test('recovers an offline wireless transport without restarting other ADB sessions', async () => {
  const calls = [];
  let attempts = 0;
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', sleep: async () => {}, exec: async (_file, args) => {
    calls.push(args.join(' '));
    if (args.at(-1) === 'get-state' && ++attempts < 3) throw new Error('error: device offline');
    return { stdout: args.at(-1) === 'get-state' ? 'device\n' : '' };
  }});
  await manager.connectWireless('192.168.1.24:5555');
  assert.equal(attempts, 3);
  assert.equal(calls.filter(command => command === 'disconnect 192.168.1.24:5555').length, 3);
  assert.equal(calls.some(command => command.includes('kill-server') || command === 'disconnect'), false);
});

test('bounds offline retries and reports an actionable failure', async () => {
  let attempts = 0;
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', sleep: async () => {}, exec: async (_file, args) => {
    if (args.at(-1) === 'get-state') { attempts++; throw new Error('device offline'); }
    return { stdout: '' };
  }});
  await assert.rejects(manager.connectWireless('192.168.1.24:5555'), /Wi-Fi may block/);
  assert.equal(attempts, 5);
});

function automaticManager({ direct = true, ip = '192.168.1.24', authorized = true } = {}) {
  const calls = [];
  const network = {
    load: async () => {}, start: async () => { calls.push('network-start'); },
    getStatus: () => ({ state: 'ready', pairedPhone: 'Phone' }), matchesUsb: () => true,
    endpoint: async () => { calls.push('network-endpoint'); return '127.0.0.1:43001'; },
    dispose: async () => {},
  };
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', network, sleep: async () => {}, exec: async (_file, args) => {
    const command = args.join(' '); calls.push(command);
    if (command === 'devices -l') return { stdout: 'List of devices attached\nUSB123 device model:Pixel_8\n' };
    if (command.endsWith('ro.product.model')) return { stdout: 'Pixel 8' };
    if (command.endsWith('ro.build.version.release')) return { stdout: '15' };
    if (command.endsWith('ro.build.version.sdk')) return { stdout: '35' };
    if (command.endsWith('service.adb.tcp.port')) return { stdout: '5555' };
    if (command.includes('shell ip')) return { stdout: ip ? `inet ${ip}/24` : '' };
    if (command.endsWith('get-state')) {
      if (!authorized) throw new Error('unauthorized');
      if (!direct && !command.includes('127.0.0.1')) throw new Error('offline');
      return { stdout: 'device' };
    }
    return { stdout: '' };
  } });
  manager.launch = async () => manager.setStatus({ state: 'mirroring' });
  return { manager, calls, network };
}

test('direct Wi-Fi success never starts the relay', async () => {
  const { manager, calls } = automaticManager(); await manager.connect();
  assert.equal(manager.lastDevice.paired, false);
  assert.equal(calls.includes('network-start'), false);
});

test('unreachable direct Wi-Fi automatically falls back to the saved paired phone', async () => {
  const { manager, calls } = automaticManager({ direct: false }); await manager.connect();
  assert.equal(manager.lastDevice.paired, true);
  assert.equal(manager.lastDevice.serial, '127.0.0.1:43001');
  assert.ok(calls.indexOf('connect 192.168.1.24:5555') < calls.indexOf('network-start'));
  assert.equal(calls.filter(command => command === 'connect 192.168.1.24:5555').length, 2);
});

test('missing LAN address falls back without attempting an invalid ADB endpoint', async () => {
  const { manager, calls } = automaticManager({ ip: '' }); await manager.connect();
  assert.equal(manager.lastDevice.paired, true);
  assert.equal(calls.some(command => command.includes('null:5555')), false);
});

test('ADB authorization errors do not trigger relay fallback', async () => {
  const { manager, calls } = automaticManager({ authorized: false });
  await assert.rejects(manager.connect(), /allow USB debugging/);
  assert.equal(calls.includes('network-start'), false);
});

test('reopens saved paired phone after restarting Windows WLSAPlus', async () => {
  const { manager } = automaticManager(); await manager.start();
  assert.equal(manager.lastDevice.serial, '127.0.0.1:43001');
  assert.equal(manager.lastDevice.sdk, 35);
});

test('does not connect an old paired phone when a different USB phone is attached', async () => {
  const { manager, network } = automaticManager({ direct: false }); network.matchesUsb = () => false;
  await assert.rejects(manager.connect(), /different phone is paired/);
});

test('cancelling setup does not allow a late result to reopen the phone', async () => {
  const { manager } = automaticManager();
  let release;
  manager.findAuthorizedUsbDevice = () => new Promise(resolve => { release = () => resolve({ serial: 'USB123' }); });
  const connecting = manager.connect();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  const stopping = manager.stop(); release(); await connecting; await stopping;
  assert.equal(manager.status.state, 'idle'); assert.equal(manager.lastDevice, null);
});

test('retries a USB read that goes offline after device discovery', async () => {
  const calls = [];
  let reads = 0;
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', sleep: async () => {}, exec: async (_file, args) => {
    const command = args.join(' '); calls.push(command);
    if (command === 'devices -l') return { stdout: 'List of devices attached\nUSB123 device\nOTHER offline\n' };
    if (command.endsWith('ro.product.model')) {
      if (++reads === 1) throw new Error('error: device offline');
      return { stdout: 'Phone' };
    }
    return { stdout: '' };
  }});
  assert.equal((await manager.runUsbAdb('USB123', ['shell', 'getprop', 'ro.product.model'])).stdout, 'Phone');
  assert.ok(calls.includes('-s USB123 reconnect'));
  assert.equal(calls.some(c => c.includes('kill-server') || c.includes('OTHER reconnect')), false);
});

test('does not restart adbd when TCP debugging is already enabled', async () => {
  const { manager, calls } = automaticManager();
  await manager.connect();
  assert.equal(calls.some(c => c.includes('tcpip')), false);
});

test('verifies TCP mode after adbd drops the tcpip response', async () => {
  let port = '', restarts = 0;
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', sleep: async () => {}, exec: async (_file, args) => {
    const command = args.join(' ');
    if (command.endsWith('service.adb.tcp.port')) return { stdout: port };
    if (command.endsWith('tcpip 5555')) { restarts++; port = '5555'; throw new Error('error: device offline'); }
    return { stdout: '' };
  }});
  await manager.enableWirelessDebugging('USB123');
  assert.equal(restarts, 1);
});

test('USB recovery stays on the selected phone and has a bounded failure', async () => {
  let polls = 0;
  const manager = new PhoneManager({ platform: 'win32', runtimeDirectory: 'C:\\phone-core', sleep: async () => {}, exec: async (_file, args) => {
    if (args[0] === 'devices') { polls++; return { stdout: 'List of devices attached\nOTHER device\nUSB123 offline\n' }; }
    return { stdout: '' };
  }});
  await assert.rejects(manager.recoverUsb('USB123'), /USB debugging stayed offline/);
  assert.equal(polls, 15);
});

test('USB recovery stops for authorization and cancellation', async () => {
  const { manager } = automaticManager();
  manager.exec = async () => ({ stdout: 'List of devices attached\nUSB123 unauthorized\n' });
  await assert.rejects(manager.recoverUsb('USB123'), error => error.code === 'ADB_AUTHORIZATION');
  manager.cancelled = true;
  manager.exec = async () => { assert.fail('cancelled recovery ran ADB'); };
  await assert.rejects(manager.recoverUsb('USB123'), /cancelled/);
  await assert.rejects(manager.runUsbAdb('USB123', ['shell', 'getprop', 'ro.product.model']), /cancelled/);
});

test('cancelled pairing still removes its USB forwarding port', async () => {
  const { manager, network, calls } = automaticManager({ direct: false });
  network.getStatus = () => ({ state: 'ready' });
  network.pair = async runAdb => {
    manager.cancelled = true;
    await runAdb(['-s', 'USB123', 'forward', '--remove', 'tcp:40001']);
    throw new Error('Pairing cancelled.');
  };
  await manager.connect();
  assert.ok(calls.includes('-s USB123 forward --remove tcp:40001'));
  assert.equal(calls.includes('network-endpoint'), false);
});

test('USB recovery does not retry unrelated failures', async () => {
  let calls = 0;
  const { manager } = automaticManager();
  manager.exec = async () => { calls++; throw new Error('permission denied'); };
  await assert.rejects(manager.runUsbAdb('USB123', ['shell', 'ip', 'route']), /permission denied/);
  assert.equal(calls, 1);
});

test('secure ADB failures report the actual tunnel failure', async () => {
  const { manager, network } = automaticManager({ authorized: true });
  network.getStatus = () => ({ state: 'ready', connectionError: 'Android debugging is off. Reconnect USB.' });
  manager.exec = async (_file, args) => {
    if (args.at(-1) === 'get-state') throw new Error('device offline');
    return { stdout: '' };
  };
  await assert.rejects(manager.connectWireless('127.0.0.1:43001'), /Android debugging is off/);
});

test('forget closes the mirror and clears the saved device and relay', async () => {
  const { manager, network, calls } = automaticManager();
  manager.lastDevice = { serial: '127.0.0.1:43001', paired: true };
  manager.stopProcess = async () => { calls.push('close-mirror'); };
  network.forget = async () => { calls.push('forget-pair'); };
  const status = await manager.disconnect();
  assert.ok(calls.includes('close-mirror'));
  assert.ok(calls.includes('forget-pair'));
  assert.ok(calls.includes('disconnect 127.0.0.1:43001'));
  assert.equal(status.state, 'idle');
  assert.equal(status.serial, null);
  assert.equal(manager.lastDevice, null);
});

test('relay video uses a lower bitrate and frame size without changing direct Wi-Fi', () => {
  const relay = buildScrcpyArguments('127.0.0.1:40001', { relay: true });
  for (const flag of ['--max-size=1280', '--max-fps=30', '--video-bit-rate=2M', '--video-buffer=0']) assert.ok(relay.includes(flag));
  assert.equal(buildScrcpyArguments('192.168.1.2:5555').some(flag => flag.startsWith('--video-bit-rate')), false);
});

async function flushTasks() {
  await new Promise(resolve => setImmediate(resolve));
}

async function mirroredManager(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { manager, network, calls } = automaticManager();
  const children = [];
  manager.launch = PhoneManager.prototype.launch;
  manager.spawnProcess = (_file, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.exitCode = null;
    child.close = code => { child.exitCode = code; child.emit('close', code); };
    child.kill = () => child.close(0);
    child.args = args; children.push(child); return child;
  };
  t.after(() => manager.dispose());
  const opening = manager.start({ turnScreenOff: false });
  await flushTasks(); t.mock.timers.tick(900); await opening;
  assert.equal(manager.status.state, 'mirroring');
  return { manager, network, calls, children };
}

test('lost mirroring reopens using the saved pair and display preference', async t => {
  const { manager, children, calls } = await mirroredManager(t);
  children[0].close(2);
  assert.equal(manager.status.state, 'reconnecting');
  t.mock.timers.tick(2000); await flushTasks();
  assert.equal(children.length, 2);
  const recovery = manager.operation;
  t.mock.timers.tick(900); await recovery;
  assert.equal(manager.status.state, 'mirroring');
  assert.equal(children[1].args.includes('--turn-screen-off'), false);
  assert.equal(calls.filter(call => call === 'network-endpoint').length, 2);
  assert.equal(calls.some(call => call.includes('kill-server')), false);
});

test('closing the mirror manually or cancelling recovery never reopens it', async t => {
  const { manager, children } = await mirroredManager(t);
  children[0].close(0);
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 1);
  assert.equal(manager.status.state, 'ready');
  const opening = manager.start(); await flushTasks(); t.mock.timers.tick(900); await opening;
  children[1].close(2);
  await manager.stop();
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 2);
  assert.equal(manager.status.state, 'ready');
});

test('recovery survives a failed attempt and stops for disabled Android debugging', async t => {
  const { manager, network, children } = await mirroredManager(t);
  const originalEndpoint = network.endpoint;
  network.endpoint = async () => { throw new Error('could not reach relay'); };
  children[0].close(2);
  t.mock.timers.tick(2000); await flushTasks();
  assert.equal(manager.status.state, 'reconnecting');
  network.endpoint = originalEndpoint;
  t.mock.timers.tick(4000); await flushTasks();
  const recovery = manager.operation; t.mock.timers.tick(900); await recovery;
  assert.equal(manager.status.state, 'mirroring');
  network.endpoint = async () => { throw new Error('Android debugging is off; reconnect USB'); };
  children[1].close(2);
  t.mock.timers.tick(2000); await flushTasks();
  assert.equal(manager.status.state, 'error');
  assert.match(manager.status.message, /debugging is off/);
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 2);
});

test('forget and application quit cancel pending mirror recovery', async t => {
  const { manager, network, children } = await mirroredManager(t);
  let forgotten = false;
  network.forget = async () => { forgotten = true; };
  children[0].close(2);
  await manager.disconnect();
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(forgotten, true); assert.equal(children.length, 1);
  assert.equal(manager.lastDevice, null);
  const opening = manager.start(); await flushTasks(); t.mock.timers.tick(900); await opening;
  children[1].close(2); manager.dispose();
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 2);
});

test('a late relay reply after Cancel cannot launch a new mirror', async t => {
  const { manager, network, children } = await mirroredManager(t);
  let release;
  network.endpoint = () => new Promise(resolve => { release = () => resolve('127.0.0.1:43001'); });
  children[0].close(2); t.mock.timers.tick(2000); await flushTasks();
  assert.ok(release);
  const stopped = manager.stop(); release(); await stopped;
  t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 1); assert.equal(manager.status.state, 'ready');
});

test('unreachable phones have bounded recovery and unrelated crashes are not retried', async t => {
  const { manager, network, children } = await mirroredManager(t);
  let attempts = 0;
  network.endpoint = async () => { attempts++; throw new Error('relay unreachable'); };
  children[0].close(2);
  for (const delay of [2000, 4000, 8000, 15000, 15000, 15000]) {
    t.mock.timers.tick(delay); await flushTasks();
  }
  assert.equal(attempts, 6); assert.equal(manager.status.state, 'error');
  t.mock.timers.tick(60000); await flushTasks(); assert.equal(attempts, 6);
  network.endpoint = async () => '127.0.0.1:43001';
  const opening = manager.start(); await flushTasks(); t.mock.timers.tick(900); await opening;
  children[1].stderr.emit('data', Buffer.from('Unsupported video encoder'));
  children[1].close(1); t.mock.timers.tick(60000); await flushTasks();
  assert.equal(children.length, 2); assert.match(manager.status.message, /Unsupported video encoder/);
});
