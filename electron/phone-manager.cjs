const { execFile, spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const ADB_PORT = 5555;
const PHONE_ACTIONS = Object.freeze({
  back: '4',
  home: '3',
  recents: '187',
  power: '26',
  'volume-up': '24',
  'volume-down': '25',
});

function parseAdbDevices(output) {
  return String(output || '')
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', state = '', ...fields] = line.split(/\s+/);
      const properties = {};
      for (const field of fields) {
        const separator = field.indexOf(':');
        if (separator > 0) properties[field.slice(0, separator)] = field.slice(separator + 1);
      }
      return { serial, state, model: String(properties.model || '').replace(/_/g, ' '), properties };
    });
}

function isWirelessSerial(serial) {
  return /:\d+$/.test(serial) || serial.includes('_adb-tls-connect._tcp');
}

function isPrivateIpv4(address) {
  if (!net.isIPv4(address)) return false;
  const [first, second] = address.split('.').map(Number);
  return first === 10
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function parseWifiIpv4(output) {
  const text = String(output || '');
  const candidates = [
    ...[...text.matchAll(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/g)].map((match) => match[1]),
    ...[...text.matchAll(/\binet\s+(\d{1,3}(?:\.\d{1,3}){3})\//g)].map((match) => match[1]),
  ];
  return candidates.find(isPrivateIpv4) || null;
}

function buildScrcpyArguments(serial, options = {}) {
  const args = [
    '--serial', serial,
    '--window-title', options.windowTitle || 'WLSAPlus Phone',
    '--keep-active',
    '--disable-screensaver',
  ];
  if (options.turnScreenOff !== false) args.push('--turn-screen-off');
  return args;
}

function phoneActionKeyCode(action) {
  const keyCode = PHONE_ACTIONS[action];
  if (!keyCode) throw new Error('Unsupported phone control action.');
  return keyCode;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function commandError(error, fallback) {
  const detail = String(error?.stderr || error?.stdout || error?.message || '').trim();
  return new Error(detail ? `${fallback} ${detail}` : fallback);
}

class PhoneManager {
  constructor({ platform = process.platform, runtimeDirectory, onStatus = () => {}, exec = execFileAsync, spawnProcess = spawn } = {}) {
    this.platform = platform;
    this.runtimeDirectory = runtimeDirectory;
    this.onStatus = onStatus;
    this.exec = exec;
    this.spawnProcess = spawnProcess;
    this.scrcpyProcess = null;
    this.operation = null;
    this.lastError = '';
    this.lastDevice = null;
    this.stopping = false;
    this.status = {
      state: platform === 'win32' ? 'idle' : 'unsupported',
      message: platform === 'win32' ? 'Connect an Android phone by USB to begin.' : 'Phone control is available on Windows only.',
      deviceName: null,
      serial: null,
      ip: null,
      androidVersion: null,
      audioAvailable: null,
      screenOff: true,
    };
  }

  get adbPath() { return path.join(this.runtimeDirectory, 'adb.exe'); }
  get scrcpyPath() { return path.join(this.runtimeDirectory, 'scrcpy.exe'); }
  getStatus() { return { ...this.status }; }

  setStatus(patch) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.getStatus());
    return this.getStatus();
  }

  assertSupported() {
    if (this.platform !== 'win32') throw new Error('Phone control is available on Windows only.');
  }

  async runAdb(args, timeout = 15_000) {
    try {
      return await this.exec(this.adbPath, args, { timeout, windowsHide: true, maxBuffer: 1024 * 1024 });
    } catch (error) {
      throw commandError(error, 'ADB command failed.');
    }
  }

  async findAuthorizedUsbDevice(timeout = 45_000) {
    const deadline = Date.now() + timeout;
    let previousState = '';
    while (Date.now() < deadline) {
      const { stdout } = await this.runAdb(['devices', '-l']);
      const usbDevices = parseAdbDevices(stdout).filter((device) => !isWirelessSerial(device.serial) && !device.serial.startsWith('emulator-'));
      if (usbDevices.length > 1) throw new Error('More than one USB Android device is connected. Disconnect the extra device and try again.');
      const [device] = usbDevices;
      if (device?.state === 'device') return device;

      const nextState = device?.state === 'unauthorized' ? 'waiting-authorization' : 'waiting-usb';
      if (nextState !== previousState) {
        this.setStatus(nextState === 'waiting-authorization'
          ? { state: nextState, message: 'Unlock the phone and tap Allow on the USB debugging prompt.' }
          : { state: nextState, message: 'Waiting for an Android phone connected by USB...' });
        previousState = nextState;
      }
      await delay(1_000);
    }
    throw new Error(previousState === 'waiting-authorization'
      ? 'USB debugging was not authorized in time. Unlock the phone, allow this computer, and try again.'
      : 'No authorized USB Android phone was found. Check the cable and USB debugging, then try again.');
  }

  connect(options = {}) {
    if (this.operation) return this.operation;
    this.operation = this.connectInternal(options)
      .catch((error) => {
        this.setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not connect to the phone.' });
        throw error;
      })
      .finally(() => { this.operation = null; });
    return this.operation;
  }

  async connectInternal(options) {
    this.assertSupported();
    await this.stopProcess();
    this.setStatus({ state: 'waiting-usb', message: 'Checking the USB connection...', screenOff: options.turnScreenOff !== false });
    await this.runAdb(['start-server']);
    const device = await this.findAuthorizedUsbDevice();
    this.setStatus({ state: 'configuring', message: 'Reading phone and Wi-Fi information...' });

    const [{ stdout: modelOutput }, { stdout: versionOutput }, { stdout: sdkOutput }, { stdout: routeOutput }, addressResult] = await Promise.all([
      this.runAdb(['-s', device.serial, 'shell', 'getprop', 'ro.product.model']),
      this.runAdb(['-s', device.serial, 'shell', 'getprop', 'ro.build.version.release']),
      this.runAdb(['-s', device.serial, 'shell', 'getprop', 'ro.build.version.sdk']),
      this.runAdb(['-s', device.serial, 'shell', 'ip', 'route']),
      this.runAdb(['-s', device.serial, 'shell', 'ip', '-o', '-4', 'addr', 'show', 'wlan0']).catch(() => ({ stdout: '' })),
    ]);
    const ip = parseWifiIpv4(`${addressResult.stdout}\n${routeOutput}`);
    if (!ip) throw new Error('The phone has no private Wi-Fi address. Connect the phone and laptop to the same Wi-Fi, then try again.');

    const deviceName = String(modelOutput || device.model || 'Android phone').trim() || 'Android phone';
    const androidVersion = String(versionOutput || '').trim() || null;
    const sdk = Number.parseInt(String(sdkOutput || '').trim(), 10);
    const wirelessSerial = `${ip}:${ADB_PORT}`;
    this.setStatus({
      state: 'configuring',
      message: 'Enabling wireless debugging. Keep USB connected for a moment...',
      deviceName,
      androidVersion,
      audioAvailable: Number.isFinite(sdk) ? sdk >= 30 : null,
      ip,
      serial: wirelessSerial,
    });

    await this.runAdb(['-s', device.serial, 'tcpip', String(ADB_PORT)]);
    await delay(1_200);
    this.setStatus({ state: 'connecting', message: `Connecting to ${deviceName} over Wi-Fi...` });
    await this.runAdb(['connect', wirelessSerial], 20_000);
    const { stdout: stateOutput } = await this.runAdb(['-s', wirelessSerial, 'get-state']);
    if (String(stateOutput).trim() !== 'device') throw new Error('The phone did not accept the wireless ADB connection. Confirm both devices are on the same Wi-Fi.');

    this.lastDevice = { serial: wirelessSerial, ip, deviceName, androidVersion, sdk };
    return this.launch(options);
  }

  start(options = {}) {
    if (this.operation) return this.operation;
    this.operation = this.startInternal(options)
      .catch((error) => {
        this.setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not reopen the phone.' });
        throw error;
      })
      .finally(() => { this.operation = null; });
    return this.operation;
  }

  async startInternal(options) {
    this.assertSupported();
    if (!this.lastDevice) throw new Error('Set up the phone by USB before reopening it wirelessly.');
    await this.stopProcess();
    this.setStatus({ state: 'connecting', message: `Reconnecting to ${this.lastDevice.deviceName}...`, screenOff: options.turnScreenOff !== false });
    await this.runAdb(['connect', this.lastDevice.serial], 20_000);
    const { stdout } = await this.runAdb(['-s', this.lastDevice.serial, 'get-state']);
    if (String(stdout).trim() !== 'device') throw new Error('The phone is not reachable. Check that it is awake and on the same Wi-Fi.');
    return this.launch(options);
  }

  async launch(options) {
    const device = this.lastDevice;
    if (!device) throw new Error('No wireless phone is configured.');
    this.lastError = '';
    const args = buildScrcpyArguments(device.serial, {
      turnScreenOff: options.turnScreenOff !== false,
      windowTitle: `WLSAPlus Phone - ${device.deviceName}`,
    });
    const child = this.spawnProcess(this.scrcpyPath, args, {
      cwd: this.runtimeDirectory,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.scrcpyProcess = child;
    child.stdout?.on('data', (chunk) => { this.lastError = `${this.lastError}${chunk}`.slice(-8_000); });
    child.stderr?.on('data', (chunk) => { this.lastError = `${this.lastError}${chunk}`.slice(-8_000); });
    child.on('error', (error) => {
      if (this.scrcpyProcess !== child || this.stopping) return;
      this.scrcpyProcess = null;
      this.setStatus({ state: 'error', message: `Could not start the phone window. ${error.message}` });
    });
    child.on('close', (code) => {
      if (this.scrcpyProcess !== child) return;
      this.scrcpyProcess = null;
      if (this.stopping) return;
      const detail = this.lastError.trim().split(/\r?\n/).filter(Boolean).at(-1);
      this.setStatus(code === 0
        ? { state: 'ready', message: 'Phone window closed. You can reopen it wirelessly.' }
        : { state: 'error', message: detail ? `Phone window closed: ${detail}` : 'Phone window closed unexpectedly.' });
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 900);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('close', (code) => { clearTimeout(timer); reject(new Error(`scrcpy exited with code ${code}. ${this.lastError.trim()}`.trim())); });
    });
    return this.setStatus({
      state: 'mirroring',
      message: device.sdk >= 30 ? 'Phone connected with video, sound, and controls.' : 'Phone connected. Audio needs Android 11 or newer.',
      deviceName: device.deviceName,
      androidVersion: device.androidVersion,
      audioAvailable: device.sdk >= 30,
      ip: device.ip,
      serial: device.serial,
      screenOff: options.turnScreenOff !== false,
    });
  }

  async stopProcess() {
    const child = this.scrcpyProcess;
    if (!child) return;
    this.stopping = true;
    this.scrcpyProcess = null;
    child.kill();
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(resolve, 2_000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
    });
    this.stopping = false;
  }

  async stop() {
    this.assertSupported();
    this.setStatus({ state: 'stopping', message: 'Closing the phone window...' });
    await this.stopProcess();
    return this.setStatus(this.lastDevice
      ? { state: 'ready', message: 'Phone window closed. You can reopen it wirelessly.' }
      : { state: 'idle', message: 'Connect an Android phone by USB to begin.' });
  }

  async disconnect() {
    this.assertSupported();
    await this.stopProcess();
    if (this.lastDevice) await this.runAdb(['disconnect', this.lastDevice.serial]).catch(() => {});
    this.lastDevice = null;
    return this.setStatus({
      state: 'idle',
      message: 'Disconnected. Connect an Android phone by USB to begin.',
      deviceName: null,
      serial: null,
      ip: null,
      androidVersion: null,
      audioAvailable: null,
    });
  }

  async control(action) {
    this.assertSupported();
    if (!this.lastDevice || this.status.state !== 'mirroring') throw new Error('Open the phone window before using remote controls.');
    await this.runAdb(['-s', this.lastDevice.serial, 'shell', 'input', 'keyevent', phoneActionKeyCode(action)]);
    return this.getStatus();
  }

  dispose() {
    this.stopping = true;
    const child = this.scrcpyProcess;
    this.scrcpyProcess = null;
    if (child && child.exitCode === null) child.kill();
  }
}

module.exports = {
  PHONE_ACTIONS,
  PhoneManager,
  buildScrcpyArguments,
  isWirelessSerial,
  parseAdbDevices,
  parseWifiIpv4,
  phoneActionKeyCode,
};
