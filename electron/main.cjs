const { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, screen, session } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const nodeHttps = require('node:https');
const nodeNet = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const CARD_TYPES = new Set(['current-class', 'next-class', 'today', 'todo']);
const cards = new Map();
const cardConfigs = new Map();
let mainWindow;
let nextCardId = 1;
let isQuitting = false;
const isAutostart = process.argv.includes('--autostart');
const VPN_PORT = 17890;
const VPN_SUBSCRIPTION_URL = 'https://vpn.02studio.xyz/api/subscribe?format=ss';
let vpnProcess = null;
let vpnDisconnecting = false;
let vpnStatus = { state: 'idle', message: 'Ready', connectedAt: null, mode: 'system-proxy' };
let quitAfterCleanup = false;
const vpnDnsCache = new Map();

const preload = path.join(__dirname, 'preload.cjs');
const credentialFile = () => path.join(app.getPath('userData'), 'credentials.bin');
const cardFile = () => path.join(app.getPath('userData'), 'desktop-cards.json');
const cardSettingsFile = () => path.join(app.getPath('userData'), 'desktop-card-settings.json');
const vpnDirectory = () => path.join(app.getPath('userData'), 'vpn');
const vpnConfigFile = () => path.join(vpnDirectory(), 'config.json');
const vpnProxyStateFile = () => path.join(vpnDirectory(), 'proxy-state.json');
const powerSchoolSession = () => session.fromPartition('persist:powerschool');
const appSession = () => session.fromPartition('persist:wlsaplus');
const iconPath = () => path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

function appUrl(route = '') {
  const dev = process.env.WLSAPLUS_DEV_URL;
  if (dev) return `${dev}/#/${route}`;
  return `file://${path.join(__dirname, '..', 'dist', 'wlsaplus', 'browser', 'index.html').replace(/\\/g, '/')}#/${route}`;
}

function webPreferences(overrides = {}) {
  return { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:wlsaplus', ...overrides };
}

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

function setVpnStatus(patch) {
  vpnStatus = { ...vpnStatus, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('vpn:status', vpnStatus);
  }
  return vpnStatus;
}

function vpnCorePath() {
  const executable = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
  return app.isPackaged ? path.join(process.resourcesPath, 'vpn-core', executable) : path.join(__dirname, '..', 'build', 'vpn-core', executable);
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='), 'base64').toString('utf8');
}

function parseShadowsocksUri(value) {
  const url = new URL(value.trim());
  if (url.protocol !== 'ss:') throw new Error('02VPN returned an unsupported profile.');
  let method;
  let password;
  if (url.password) {
    method = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
  } else {
    const credentials = decodeBase64Url(decodeURIComponent(url.username));
    const separator = credentials.indexOf(':');
    if (separator < 1) throw new Error('02VPN returned an invalid profile.');
    method = credentials.slice(0, separator);
    password = credentials.slice(separator + 1);
  }
  const plugin = decodeURIComponent(url.searchParams.get('plugin') || '');
  const [pluginName, ...pluginOptions] = plugin.split(';').filter(Boolean);
  if (pluginName && pluginName !== 'v2ray-plugin') throw new Error(`02VPN requires an unsupported plugin: ${pluginName}.`);
  if (!url.hostname || !url.port || !method || !password) throw new Error('02VPN returned an incomplete profile.');
  return { server: url.hostname, serverPort: Number(url.port), method, password, plugin: pluginName || undefined, pluginOptions: pluginOptions.join(';') || undefined };
}

function isPublicIpv4(address) {
  if (!nodeNet.isIPv4(address)) return false;
  const [first, second] = address.split('.').map(Number);
  return first !== 0
    && first !== 10
    && first !== 127
    && first < 224
    && !(first === 169 && second === 254)
    && !(first === 172 && second >= 16 && second <= 31)
    && !(first === 192 && second === 168)
    && !(first === 198 && (second === 18 || second === 19));
}

async function resolvePublicIpv4(hostname) {
  if (nodeNet.isIPv4(hostname)) return [hostname];
  if (vpnDnsCache.has(hostname)) return vpnDnsCache.get(hostname);
  const resolvers = [
    { address: '223.5.5.5', servername: 'dns.alidns.com', path: `/resolve?name=${encodeURIComponent(hostname)}&type=A` },
    { address: '223.6.6.6', servername: 'dns.alidns.com', path: `/resolve?name=${encodeURIComponent(hostname)}&type=A` },
    { address: '1.12.12.12', servername: 'doh.pub', path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A` },
    { address: '120.53.53.53', servername: 'doh.pub', path: `/dns-query?name=${encodeURIComponent(hostname)}&type=A` },
  ];
  for (const resolver of resolvers) {
    try {
      const response = await secureGetByAddress(resolver.address, resolver.servername, resolver.path, 'application/dns-json');
      if (response.status !== 200) continue;
      const result = JSON.parse(response.text);
      const publicAddresses = Array.isArray(result.Answer)
        ? result.Answer.filter((answer) => Number(answer?.type) === 1).map((answer) => String(answer.data)).filter(isPublicIpv4)
        : [];
      if (publicAddresses.length) {
        vpnDnsCache.set(hostname, publicAddresses);
        return publicAddresses;
      }
    } catch { /* Try the next direct encrypted resolver. */ }
  }
  throw new Error('Could not resolve the 02VPN server outside the system DNS.');
}

function secureGetByAddress(address, servername, requestPath, accept = 'text/plain') {
  return new Promise((resolve, reject) => {
    const request = nodeHttps.request({
      host: address,
      port: 443,
      servername,
      path: requestPath,
      method: 'GET',
      headers: { Host: servername, Accept: accept, 'User-Agent': `WLSAPlus/${app.getVersion()}` },
      timeout: 10_000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode || 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    request.on('timeout', () => request.destroy(new Error('Request timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function fetchVpnProfile() {
  const subscription = new URL(VPN_SUBSCRIPTION_URL);
  const addresses = await resolvePublicIpv4(subscription.hostname);
  let lastError;
  for (const address of addresses) {
    try {
      const response = await secureGetByAddress(address, subscription.hostname, `${subscription.pathname}${subscription.search}`);
      if (response.status !== 200) throw new Error(`02VPN subscription returned ${response.status}.`);
      const body = response.text.trim();
      const decoded = body.startsWith('ss://') ? body : decodeBase64Url(body);
      const profile = decoded.split(/\r?\n/).find((line) => line.startsWith('ss://'));
      if (!profile) throw new Error('02VPN did not return a usable profile.');
      return parseShadowsocksUri(profile);
    } catch (error) { lastError = error; }
  }
  throw new Error(lastError?.message || 'Could not download the 02VPN subscription.');
}

async function resolveVpnServer(profile) {
  if (nodeNet.isIP(profile.server)) return profile;
  const [address] = await resolvePublicIpv4(profile.server);
  return { ...profile, server: address };
}

async function writeVpnConfig(profile) {
  const outbound = { type: 'shadowsocks', tag: '02vpn', server: profile.server, server_port: profile.serverPort, method: profile.method, password: profile.password };
  if (profile.plugin) outbound.plugin = profile.plugin;
  if (profile.pluginOptions) outbound.plugin_opts = profile.pluginOptions;
  const config = {
    log: { level: 'warn', timestamp: true },
    inbounds: [{ type: 'mixed', tag: 'local-proxy', listen: '127.0.0.1', listen_port: VPN_PORT }],
    outbounds: [outbound],
    route: { auto_detect_interface: true, final: '02vpn' },
  };
  await fs.mkdir(vpnDirectory(), { recursive: true });
  await fs.writeFile(vpnConfigFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function waitForPort(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const connected = await new Promise((resolve) => {
      const socket = nodeNet.createConnection({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
      socket.setTimeout(400, () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await delay(180);
  }
  throw new Error('The VPN core did not start in time.');
}

async function verifyVpnConnection() {
  const probeSession = session.fromPartition('wlsaplus-vpn-probe');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  await probeSession.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${VPN_PORT};https=127.0.0.1:${VPN_PORT}` });
  try {
    const response = await probeSession.fetch('https://www.gstatic.com/generate_204', { cache: 'no-store', signal: controller.signal });
    if (response.status !== 204 && !response.ok) throw new Error(`VPN health check returned ${response.status}.`);
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? '02VPN did not respond in time.' : 'Could not reach the internet through 02VPN.');
  } finally {
    clearTimeout(timeout);
    await probeSession.setProxy({ mode: 'direct' }).catch(() => {});
    await probeSession.closeAllConnections().catch(() => {});
  }
}

async function readWindowsProxyValue(name) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], { windowsHide: true });
    const match = stdout.match(new RegExp(`^\\s*${name}\\s+(REG_\\w+)\\s+(.*)$`, 'mi'));
    return match ? { exists: true, type: match[1], value: match[2].trim() } : { exists: false };
  } catch { return { exists: false }; }
}

async function writeWindowsProxyValue(name, type, value) {
  await execFileAsync('reg.exe', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name, '/t', type, '/d', String(value), '/f'], { windowsHide: true });
}

async function notifyWindowsProxyChanged() {
  const script = "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class WlsaProxy { [DllImport(\"wininet.dll\")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l); }'; [WlsaProxy]::InternetSetOption([IntPtr]::Zero,39,[IntPtr]::Zero,0) | Out-Null; [WlsaProxy]::InternetSetOption([IntPtr]::Zero,37,[IntPtr]::Zero,0) | Out-Null";
  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
}

async function readMacProxy(service, kind) {
  const { stdout } = await execFileAsync('networksetup', [`-get${kind}proxy`, service]);
  const values = Object.fromEntries(stdout.split(/\r?\n/).map((line) => line.match(/^([^:]+):\s*(.*)$/)).filter(Boolean).map((match) => [match[1].trim(), match[2].trim()]));
  return { enabled: values.Enabled === 'Yes', server: values.Server || '', port: Number(values.Port || 0) };
}

async function captureSystemProxyState() {
  if (process.platform === 'win32') {
    return { platform: 'win32', values: {
      ProxyEnable: await readWindowsProxyValue('ProxyEnable'), ProxyServer: await readWindowsProxyValue('ProxyServer'), ProxyOverride: await readWindowsProxyValue('ProxyOverride'),
    } };
  }
  if (process.platform === 'darwin') {
    const { stdout } = await execFileAsync('networksetup', ['-listallnetworkservices']);
    const services = stdout.split(/\r?\n/).slice(1).map((value) => value.trim()).filter((value) => value && !value.startsWith('*'));
    return { platform: 'darwin', services: await Promise.all(services.map(async (service) => ({ service, web: await readMacProxy(service, 'web'), secure: await readMacProxy(service, 'secureweb') }))) };
  }
  throw new Error('VPN is unavailable on this platform.');
}

async function enableSystemProxy() {
  const state = await captureSystemProxyState();
  await fs.mkdir(vpnDirectory(), { recursive: true });
  await fs.writeFile(vpnProxyStateFile(), JSON.stringify(state), { mode: 0o600 });
  if (process.platform === 'win32') {
    await writeWindowsProxyValue('ProxyServer', 'REG_SZ', `http=127.0.0.1:${VPN_PORT};https=127.0.0.1:${VPN_PORT}`);
    await writeWindowsProxyValue('ProxyOverride', 'REG_SZ', '<local>');
    await writeWindowsProxyValue('ProxyEnable', 'REG_DWORD', '1');
    await notifyWindowsProxyChanged();
    return;
  }
  for (const item of state.services) {
    await execFileAsync('networksetup', ['-setwebproxy', item.service, '127.0.0.1', String(VPN_PORT)]);
    await execFileAsync('networksetup', ['-setsecurewebproxy', item.service, '127.0.0.1', String(VPN_PORT)]);
    await execFileAsync('networksetup', ['-setwebproxystate', item.service, 'on']);
    await execFileAsync('networksetup', ['-setsecurewebproxystate', item.service, 'on']);
  }
}

async function restoreSystemProxy(state) {
  if (!state) return;
  if (state.platform === 'win32' && process.platform === 'win32') {
    for (const [name, value] of Object.entries(state.values || {})) {
      if (value.exists) await writeWindowsProxyValue(name, value.type, value.value);
      else await execFileAsync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name, '/f'], { windowsHide: true }).catch(() => {});
    }
    await notifyWindowsProxyChanged();
  } else if (state.platform === 'darwin' && process.platform === 'darwin') {
    for (const item of state.services || []) {
      for (const [kind, value] of [['web', item.web], ['secureweb', item.secure]]) {
        if (value.server && value.port) await execFileAsync('networksetup', [`-set${kind}proxy`, item.service, value.server, String(value.port)]);
        await execFileAsync('networksetup', [`-set${kind}proxystate`, item.service, value.enabled ? 'on' : 'off']);
      }
    }
  }
  await fs.rm(vpnProxyStateFile(), { force: true });
}

async function restoreSavedSystemProxy() {
  const state = await readJson(vpnProxyStateFile(), null);
  if (state) await restoreSystemProxy(state);
}

async function connectVpn() {
  if (vpnProcess && vpnStatus.state === 'connected') return vpnStatus;
  setVpnStatus({ state: 'connecting', message: 'Connecting to 02VPN...', connectedAt: null, mode: 'system-proxy' });
  try {
    const core = vpnCorePath();
    await fs.access(core);
    const profile = await resolveVpnServer(await fetchVpnProfile());
    if (profile.plugin === 'v2ray-plugin') await fs.access(path.join(path.dirname(core), process.platform === 'win32' ? 'v2ray-plugin.exe' : 'v2ray-plugin'));
    await writeVpnConfig(profile);
    vpnDisconnecting = false;
    const environment = { ...process.env };
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'PATH';
    environment[pathKey] = `${path.dirname(core)}${path.delimiter}${environment[pathKey] || ''}`;
    const child = spawn(core, ['run', '-c', vpnConfigFile()], { env: environment, windowsHide: true, stdio: 'ignore' });
    vpnProcess = child;
    child.once('exit', () => {
      if (vpnProcess !== child) return;
      vpnProcess = null;
      if (!vpnDisconnecting) void restoreSavedSystemProxy().finally(() => setVpnStatus({ state: 'error', message: '02VPN stopped unexpectedly.', connectedAt: null }));
    });
    await waitForPort(VPN_PORT);
    await verifyVpnConnection();
    await enableSystemProxy();
    return setVpnStatus({ state: 'connected', message: 'Protected by 02VPN', connectedAt: new Date().toISOString(), mode: 'system-proxy' });
  } catch (error) {
    if (vpnProcess) { vpnDisconnecting = true; vpnProcess.kill(); vpnProcess = null; }
    await restoreSavedSystemProxy().catch(() => {});
    const missingCore = error && (error.code === 'ENOENT' || error.code === 'EACCES');
    return setVpnStatus({ state: 'error', message: missingCore ? 'VPN core is missing. Run npm run vpn:core.' : (error instanceof Error ? error.message : 'Could not connect to 02VPN.'), connectedAt: null, mode: 'system-proxy' });
  }
}

async function disconnectVpn() {
  setVpnStatus({ state: 'disconnecting', message: 'Disconnecting...' });
  vpnDisconnecting = true;
  await restoreSavedSystemProxy().catch(() => {});
  if (vpnProcess) { const child = vpnProcess; vpnProcess = null; child.kill(); }
  vpnDisconnecting = false;
  return setVpnStatus({ state: 'idle', message: 'Ready', connectedAt: null, mode: 'system-proxy' });
}

async function captureScreenRegion(event) {
  if (process.platform !== 'win32') throw new Error('Screen translation is available on Windows only.');
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (!parent || parent.isDestroyed()) throw new Error('The application window is unavailable.');
  const display = screen.getDisplayMatching(parent.getBounds());
  parent.hide();
  let sources;
  try {
    await delay(180);
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) } });
  } finally {
    if (!parent.isDestroyed()) { parent.show(); parent.focus(); }
  }
  const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('Could not capture the screen.');
  const token = crypto.randomUUID();
  const overlay = new BrowserWindow({ ...display.bounds, frame: false, resizable: false, movable: false, alwaysOnTop: true, skipTaskbar: true, backgroundColor: '#000000', webPreferences: { preload: path.join(__dirname, 'capture-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => { if (settled) return; settled = true; ipcMain.removeListener('capture:result', resultHandler); if (!overlay.isDestroyed()) overlay.close(); resolve(value); };
    const resultHandler = (ipcEvent, result) => { if (ipcEvent.sender === overlay.webContents && result?.token === token) finish(typeof result.image === 'string' ? result.image : null); };
    ipcMain.on('capture:result', resultHandler);
    overlay.on('closed', () => finish(null));
    overlay.loadFile(path.join(__dirname, 'capture.html')).then(() => overlay.webContents.send('capture:init', { token, image: source.thumbnail.toDataURL() })).catch((error) => { ipcMain.removeListener('capture:result', resultHandler); reject(error); });
  });
}

async function translateWithGoogle(value, source, target) {
  const params = new URLSearchParams({ client: 'gtx', sl: source, tl: target, dt: 't', q: value });
  const response = await fetch(`https://translate.googleapis.com/translate_a/single?${params}`);
  if (!response.ok) throw new Error('Google Translate is unavailable.');
  const result = await response.json();
  if (!Array.isArray(result) || !Array.isArray(result[0])) throw new Error('The translation response was invalid.');
  return { text: result[0].map((part) => Array.isArray(part) ? String(part[0] || '') : '').join(''), detectedLanguage: typeof result[2] === 'string' ? result[2] : source };
}

async function translateWithMyMemory(value, source, target) {
  const params = new URLSearchParams({ q: value, langpair: `${source === 'auto' ? 'Autodetect' : source}|${target}` });
  const response = await fetch(`https://api.mymemory.translated.net/get?${params}`);
  if (!response.ok) throw new Error('Translation service is unavailable. Please try again later.');
  const result = await response.json();
  if (result?.responseStatus !== 200 || typeof result?.responseData?.translatedText !== 'string') {
    throw new Error(typeof result?.responseDetails === 'string' && result.responseDetails.trim() ? result.responseDetails : 'The translation response was invalid.');
  }
  return { text: result.responseData.translatedText, detectedLanguage: typeof result.responseData.detectedLanguage === 'string' ? result.responseData.detectedLanguage : source };
}

function splitTextByBytes(value, maximumBytes) {
  const chunks = [];
  let chunk = '';
  let chunkBytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (chunk && chunkBytes + characterBytes > maximumBytes) {
      chunks.push(chunk);
      chunk = '';
      chunkBytes = 0;
    }
    chunk += character;
    chunkBytes += characterBytes;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

async function translateText(text, source, target) {
  const value = String(text || '').trim().slice(0, 5000);
  if (!value) return { text: '', detectedLanguage: String(source || 'auto') };
  const safeSource = /^[a-zA-Z-]{2,10}$/.test(source) ? source : 'auto';
  const safeTarget = /^[a-zA-Z-]{2,10}$/.test(target) ? target : 'en';
  try { return await translateWithGoogle(value, safeSource, safeTarget); }
  catch {
    const translations = [];
    let detectedLanguage = safeSource;
    for (const chunk of splitTextByBytes(value, 450)) {
      const translated = await translateWithMyMemory(chunk, safeSource, safeTarget);
      translations.push(translated.text);
      if (detectedLanguage === 'auto' && translated.detectedLanguage !== 'auto') detectedLanguage = translated.detectedLanguage;
    }
    return { text: translations.join(''), detectedLanguage };
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({ width: 1220, height: 820, minWidth: 380, minHeight: 600, backgroundColor: '#f7f8fa', title: 'WLSAPlus', icon: iconPath(), webPreferences: webPreferences() });
  mainWindow.loadURL(appUrl());
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function persistCards() {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(cardFile(), JSON.stringify([...cardConfigs.values()], null, 2));
}

async function getCardSettings() {
  return { launchAtStartup: Boolean((await readJson(cardSettingsFile(), { launchAtStartup: true })).launchAtStartup) };
}

async function setLaunchAtStartup(value) {
  const launchAtStartup = Boolean(value);
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(cardSettingsFile(), JSON.stringify({ launchAtStartup }, null, 2));
  if (process.platform === 'win32' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: launchAtStartup, args: ['--autostart'] });
  return { launchAtStartup };
}

function validateBaseUrl(value) {
  const url = new URL(String(value));
  if (url.protocol !== 'https:' && !(process.env.WLSAPLUS_DEV_ALLOW_HTTP === '1' && url.protocol === 'http:')) throw new Error('Only HTTPS PowerSchool servers are allowed.');
  return url.origin;
}

ipcMain.handle('credentials:get', async () => {
  try {
    const encrypted = await fs.readFile(credentialFile());
    if (!safeStorage.isEncryptionAvailable()) return null;
    return JSON.parse(safeStorage.decryptString(encrypted));
  } catch { return null; }
});
ipcMain.handle('credentials:set', async (_event, value) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('System credential encryption is unavailable.');
  const credentials = { schoolUrl: String(value.schoolUrl), username: String(value.username), password: String(value.password) };
  await fs.writeFile(credentialFile(), safeStorage.encryptString(JSON.stringify(credentials)), { mode: 0o600 });
});
ipcMain.handle('credentials:clear', async () => { await fs.rm(credentialFile(), { force: true }); });

ipcMain.handle('powerschool:request', async (_event, options) => {
  const origin = validateBaseUrl(options.baseUrl);
  const requestUrl = new URL(String(options.path), origin);
  if (requestUrl.origin !== origin) throw new Error('Cross-origin PowerSchool request blocked.');
  const response = await powerSchoolSession().fetch(requestUrl.toString(), {
    method: options.method === 'POST' ? 'POST' : 'GET',
    headers: options.headers || {},
    body: options.method === 'POST' ? String(options.body || '') : undefined,
    redirect: 'follow',
  });
  return { status: response.status, url: response.url, text: await response.text() };
});
ipcMain.handle('powerschool:clear-session', async (_event, baseUrl) => {
  const origin = validateBaseUrl(baseUrl);
  await powerSchoolSession().clearStorageData({ origin, storages: ['cookies'] });
});

function createCardWindow(id, type, bounds) {
  const size = type === 'today' || type === 'todo' ? { width: 340, height: 360 } : { width: 340, height: 230 };
  const win = new BrowserWindow({ ...size, ...(bounds || {}), minWidth: 300, minHeight: 220, maxWidth: 720, maxHeight: 760, resizable: true, frame: false, show: false, focusable: true, alwaysOnTop: false, skipTaskbar: true, transparent: false, backgroundColor: '#ffffff', title: `WLSAPlus ${type}`, icon: iconPath(), webPreferences: webPreferences({ backgroundThrottling: false }) });
  win.once('ready-to-show', () => win.showInactive());
  win.wlsaType = type;
  cards.set(id, win);
  cardConfigs.set(id, { id, type, bounds: win.getBounds() });
  win.on('move', () => { if (!isQuitting) { cardConfigs.set(id, { id, type, bounds: win.getBounds() }); void persistCards(); } });
  win.on('resize', () => { if (!isQuitting) { cardConfigs.set(id, { id, type, bounds: win.getBounds() }); void persistCards(); } });
  win.on('closed', () => { cards.delete(id); if (!isQuitting) { cardConfigs.delete(id); void persistCards(); } });
  win.loadURL(appUrl(`widget/${type}`));
  return { id, type };
}

ipcMain.handle('cards:list', () => [...cards].map(([id, win]) => ({ id, type: win.wlsaType })));
ipcMain.handle('cards:get-settings', () => getCardSettings());
ipcMain.handle('cards:set-settings', (_event, value) => setLaunchAtStartup(value?.launchAtStartup));
ipcMain.handle('cards:add', (_event, type) => {
  if (process.platform !== 'win32' || !CARD_TYPES.has(type)) throw new Error('Desktop cards are only available on Windows.');
  const id = nextCardId++;
  const offset = (id - 1) % 4;
  return createCardWindow(id, type, { x: 32 + offset * 350, y: 80 + Math.floor((id - 1) / 4) * 260 });
});
ipcMain.handle('cards:remove', (_event, id) => { cards.get(Number(id))?.close(); });
ipcMain.handle('vpn:status', () => vpnStatus);
ipcMain.handle('vpn:connect', () => connectVpn());
ipcMain.handle('vpn:disconnect', () => disconnectVpn());
ipcMain.handle('translator:translate', (_event, text, source, target) => translateText(text, source, target));
ipcMain.handle('translator:capture-region', (event) => captureScreenRegion(event));

app.whenReady().then(async () => {
  await restoreSavedSystemProxy().catch(() => {});
  await appSession().clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }).catch(() => {});
  if (process.platform === 'win32' && app.isPackaged) {
    const settings = await getCardSettings();
    app.setLoginItemSettings({ openAtLogin: settings.launchAtStartup, args: ['--autostart'] });
  }
  const savedCards = await readJson(cardFile(), []);
  if (process.platform === 'win32' && Array.isArray(savedCards)) {
    for (const config of savedCards) {
      if (!CARD_TYPES.has(config.type)) continue;
      const id = Number(config.id);
      if (!Number.isInteger(id) || id < 1) continue;
      nextCardId = Math.max(nextCardId, id + 1);
      cardConfigs.set(id, config);
      createCardWindow(id, config.type, config.bounds);
    }
  }
  if (!isAutostart || cards.size === 0) createMainWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createMainWindow(); });
});
app.on('before-quit', (event) => {
  isQuitting = true;
  if ((vpnProcess || vpnStatus.state === 'connected') && !quitAfterCleanup) {
    event.preventDefault();
    void disconnectVpn().finally(() => { quitAfterCleanup = true; app.quit(); });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
