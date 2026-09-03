const { app, BrowserWindow, desktopCapturer, ipcMain, safeStorage, screen, session } = require('electron');
const { execFile, spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const nodeHttps = require('node:https');
const nodeNet = require('node:net');
const path = require('node:path');
const { promisify } = require('node:util');
const { autoUpdater } = require('electron-updater');
const { VPN_CONNECTION_MODES, buildVpnConfig } = require('./vpn-config.cjs');
const { updateFeed } = require('./update-config.cjs');
const { closeAllCards } = require('./card-manager.cjs');

function handleSquirrelEvent() {
  if (process.platform !== 'win32') return false;
  const event = process.argv[1];
  if (!event?.startsWith('--squirrel-')) return false;
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exeName = path.basename(process.execPath);
  const runUpdate = (args) => {
    try {
      const child = spawn(updateExe, args, { detached: true, windowsHide: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    } catch { /* Installation can still be repaired by rerunning Setup. */ }
  };
  if (event === '--squirrel-install' || event === '--squirrel-updated') {
    runUpdate(['--createShortcut', exeName]);
    setTimeout(() => app.quit(), 1_000);
    return true;
  } else if (event === '--squirrel-uninstall') {
    runUpdate(['--removeShortcut', exeName]);
    setTimeout(() => app.quit(), 1_000);
    return true;
  } else if (event === '--squirrel-obsolete') {
    app.quit();
    return true;
  }
  return false;
}

const isSquirrelEvent = handleSquirrelEvent();
const hasSingleInstanceLock = isSquirrelEvent || app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) app.quit();

const execFileAsync = promisify(execFile);

const CARD_TYPES = new Set(['current-class', 'next-class', 'today', 'todo']);
const cards = new Map();
const cardConfigs = new Map();
let mainWindow;
let nextCardId = 1;
let isQuitting = false;
const isAutostart = process.argv.includes('--autostart');
const prepareUpdateMode = process.argv.includes('--prepare-update');
const vpnAutoConnectMode = process.argv.includes('--vpn-autoconnect=full-tunnel') ? 'full-tunnel' : null;
const VPN_PORT = 17890;
const VPN_SUBSCRIPTION_URL = 'https://vpn.02studio.xyz/api/subscribe?format=ss';
let vpnProcess = null;
let vpnDisconnecting = false;
let vpnStatus = { state: 'idle', message: 'Ready', connectedAt: null, mode: 'system-proxy' };
let vpnProcessError = '';
let quitAfterCleanup = false;
let updateInstallRequested = false;
let updateFeedSource = 'mirror';
const vpnDnsCache = new Map();
const updatesSupported = process.platform === 'win32' && app.isPackaged;
let updateStatus = {
  state: updatesSupported ? 'idle' : 'unsupported',
  message: updatesSupported ? 'Ready to check for updates.' : 'Automatic updates are available in the installed Windows app.',
  currentVersion: app.getVersion(),
  version: null,
  percent: null,
};

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

async function writeVpnConfig(profile, mode) {
  const config = buildVpnConfig(profile, mode, VPN_PORT);
  await fs.mkdir(vpnDirectory(), { recursive: true });
  await fs.writeFile(vpnConfigFile(), JSON.stringify(config, null, 2), { mode: 0o600 });
}

function setUpdateStatus(patch) {
  updateStatus = { ...updateStatus, ...patch };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('updater:status', updateStatus);
  }
  return updateStatus;
}

async function validateVpnConfig(core) {
  try {
    await execFileAsync(core, ['check', '-c', vpnConfigFile()], { windowsHide: true });
  } catch (error) {
    const detail = String(error?.stderr || error?.stdout || '').trim();
    throw new Error(detail || 'The generated VPN configuration is invalid.');
  }
}

async function isWindowsAdministrator() {
  if (process.platform !== 'win32') return false;
  const script = "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    return stdout.trim().toLowerCase() === 'true';
  } catch { return false; }
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function quoteWindowsArgument(value) {
  const text = String(value);
  if (!/[\s"]/u.test(text)) return text;
  return `"${text.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

async function restartVpnElevated(mode) {
  if (process.platform !== 'win32' || mode !== 'full-tunnel') throw new Error('Administrator restart is available for Windows full-device mode only.');
  if (await isWindowsAdministrator()) return connectVpn(mode);

  const launchArguments = app.isPackaged ? ['--vpn-autoconnect=full-tunnel'] : [app.getAppPath(), '--vpn-autoconnect=full-tunnel'];
  const argumentString = launchArguments.map(quoteWindowsArgument).join(' ');
  const script = `Start-Process -FilePath ${powershellLiteral(process.execPath)} -ArgumentList ${powershellLiteral(argumentString)} -Verb RunAs`;
  app.releaseSingleInstanceLock();
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
  } catch (error) {
    app.requestSingleInstanceLock();
    throw new Error(error?.code === 1223 ? 'Administrator approval was cancelled.' : 'Could not restart WLSAPlus as administrator.');
  }
  setTimeout(() => app.quit(), 100);
  return setVpnStatus({ state: 'connecting', message: 'Restarting with administrator access...', connectedAt: null, mode, requiresElevation: false });
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

async function waitForFullTunnelInterface() {
  if (process.platform !== 'win32') return;
  const script = "$deadline = [DateTime]::UtcNow.AddSeconds(12); do { $adapter = Get-NetAdapter -IncludeHidden -Name 'WLSAPlus' -ErrorAction SilentlyContinue; $dns = @((Get-DnsClientServerAddress -InterfaceAlias 'WLSAPlus' -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses); if ($adapter.Status -eq 'Up' -and $dns.Count -gt 0) { exit 0 }; Start-Sleep -Milliseconds 300 } while ([DateTime]::UtcNow -lt $deadline); exit 1";
  try {
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000 });
  } catch {
    throw new Error('02VPN could not finish creating the Windows full-device tunnel.');
  }
}

async function probeVpnUrls(probeSession, urls, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.any(urls.map(async (url) => {
      const response = await probeSession.fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok && response.status !== 204) throw new Error(`HTTP ${response.status}`);
      return response.status;
    }));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function verifyVpnConnection(mode) {
  const probeSession = session.fromPartition('wlsaplus-vpn-probe');
  await probeSession.setProxy(mode === 'full-tunnel'
    ? { mode: 'direct' }
    : { mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${VPN_PORT};https=127.0.0.1:${VPN_PORT}` });
  try {
    const urls = [
      'https://www.gstatic.com/generate_204',
      'https://www.cloudflare.com/cdn-cgi/trace',
      'https://weixin.qq.com/',
    ];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await probeSession.closeAllConnections().catch(() => {});
      await probeSession.clearHostResolverCache().catch(() => {});
      try {
        await probeVpnUrls(probeSession, urls, 10_000);
        return;
      } catch {
        if (attempt < 2) await delay(800 * (attempt + 1));
      }
    }
    throw new Error(`02VPN started, but ${mode === 'full-tunnel' ? 'tunneled DNS' : 'the proxy'} did not become ready. Please reconnect.`);
  } finally {
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

async function stopVpnProcess() {
  const child = vpnProcess;
  vpnProcess = null;
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL'); resolve(); }, 2_000);
    child.once('exit', () => { clearTimeout(timeout); resolve(); });
    child.kill();
  });
}

function normalizeVpnMode(value) {
  return VPN_CONNECTION_MODES.has(value) ? value : 'system-proxy';
}

async function connectVpn(requestedMode = 'system-proxy') {
  const mode = normalizeVpnMode(requestedMode);
  if (vpnProcess && vpnStatus.state === 'connected' && vpnStatus.mode === mode) return vpnStatus;
  if (vpnProcess) await disconnectVpn();
  if (mode === 'full-tunnel' && process.platform !== 'win32') {
    return setVpnStatus({ state: 'error', message: 'Full-device mode is currently available on Windows only.', connectedAt: null, mode, requiresElevation: false });
  }
  if (mode === 'full-tunnel' && !(await isWindowsAdministrator())) {
    return restartVpnElevated(mode);
  }
  setVpnStatus({ state: 'connecting', message: `Connecting 02VPN ${mode === 'full-tunnel' ? 'full-device tunnel' : 'web proxy'}...`, connectedAt: null, mode, requiresElevation: false });
  try {
    const core = vpnCorePath();
    await fs.access(core);
    const profile = await resolveVpnServer(await fetchVpnProfile());
    if (profile.plugin === 'v2ray-plugin') await fs.access(path.join(path.dirname(core), process.platform === 'win32' ? 'v2ray-plugin.exe' : 'v2ray-plugin'));
    await writeVpnConfig(profile, mode);
    await validateVpnConfig(core);
    vpnDisconnecting = false;
    vpnProcessError = '';
    const environment = { ...process.env };
    const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === 'path') || 'PATH';
    environment[pathKey] = `${path.dirname(core)}${path.delimiter}${environment[pathKey] || ''}`;
    const child = spawn(core, ['run', '-c', vpnConfigFile()], { env: environment, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    vpnProcess = child;
    child.stderr.on('data', (chunk) => { vpnProcessError = `${vpnProcessError}${chunk}`.slice(-8_192); });
    child.once('error', (error) => { vpnProcessError = error.message; });
    child.once('exit', (code) => {
      if (vpnProcess !== child) return;
      vpnProcess = null;
      if (!vpnDisconnecting) {
        const detail = vpnProcessError.trim().split(/\r?\n/).at(-1);
        void restoreSavedSystemProxy().finally(() => setVpnStatus({ state: 'error', message: detail || `02VPN stopped unexpectedly (${code ?? 'unknown'}).`, connectedAt: null, mode, requiresElevation: false }));
      }
    });
    await waitForPort(VPN_PORT);
    if (mode === 'full-tunnel') await waitForFullTunnelInterface();
    await verifyVpnConnection(mode);
    if (mode === 'system-proxy') await enableSystemProxy();
    return setVpnStatus({ state: 'connected', message: mode === 'full-tunnel' ? 'Full device protected by 02VPN' : 'Web traffic protected by 02VPN', connectedAt: new Date().toISOString(), mode, requiresElevation: false });
  } catch (error) {
    const processExited = !vpnProcess || vpnProcess.exitCode !== null;
    vpnDisconnecting = true;
    await stopVpnProcess();
    await restoreSavedSystemProxy().catch(() => {});
    const missingCore = error && (error.code === 'ENOENT' || error.code === 'EACCES');
    const processDetail = processExited ? vpnProcessError.trim().split(/\r?\n/).at(-1) : '';
    const message = missingCore ? 'VPN core is missing. Run npm run vpn:core.' : (processDetail || (error instanceof Error ? error.message : 'Could not connect to 02VPN.'));
    return setVpnStatus({ state: 'error', message, connectedAt: null, mode, requiresElevation: false });
  }
}

async function disconnectVpn() {
  const mode = normalizeVpnMode(vpnStatus.mode);
  setVpnStatus({ state: 'disconnecting', message: 'Disconnecting...', mode, requiresElevation: false });
  vpnDisconnecting = true;
  await restoreSavedSystemProxy().catch(() => {});
  await stopVpnProcess();
  vpnDisconnecting = false;
  return setVpnStatus({ state: 'idle', message: 'Ready', connectedAt: null, mode, requiresElevation: false });
}

function updaterErrorMessage(error) {
  const detail = error instanceof Error ? error.message : String(error || '');
  if (/net::|network|internet|ENOTFOUND|ETIMEDOUT|ECONN/u.test(detail)) return 'Could not check for updates. Check your internet connection.';
  return 'The update service is temporarily unavailable.';
}

function configureUpdateFeed(source) {
  autoUpdater.setFeedURL(updateFeed(source));
  updateFeedSource = source;
}

async function checkForAppUpdate() {
  if (!updatesSupported) return updateStatus;
  if (updateStatus.state === 'checking' || updateStatus.state === 'downloading' || updateStatus.state === 'ready') return updateStatus;
  setUpdateStatus({ state: 'checking', message: 'Checking for updates...', percent: null });
  try {
    configureUpdateFeed('mirror');
    await autoUpdater.checkForUpdates();
  } catch {
    setUpdateStatus({ state: 'checking', message: 'Update mirror unavailable. Trying GitHub...', percent: null });
    try {
      configureUpdateFeed('github');
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setUpdateStatus({ state: 'error', message: updaterErrorMessage(error), percent: null });
    }
  }
  return updateStatus;
}

async function downloadAppUpdate() {
  if (!updatesSupported || updateStatus.state !== 'available') return updateStatus;
  setUpdateStatus({ state: 'downloading', message: `Downloading WLSAPlus ${updateStatus.version}...`, percent: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch (error) {
    if (updateFeedSource !== 'mirror') {
      setUpdateStatus({ state: 'error', message: updaterErrorMessage(error), percent: null });
      return updateStatus;
    }
    const version = updateStatus.version;
    setUpdateStatus({ state: 'checking', message: 'Update mirror unavailable. Trying GitHub...', percent: null });
    try {
      configureUpdateFeed('github');
      await autoUpdater.checkForUpdates();
      setUpdateStatus({ state: 'downloading', message: `Downloading WLSAPlus ${version}...`, version, percent: 0 });
      await autoUpdater.downloadUpdate();
    } catch (fallbackError) {
      setUpdateStatus({ state: 'error', message: updaterErrorMessage(fallbackError), percent: null });
    }
  }
  return updateStatus;
}

async function cleanupBeforeUpdate() {
  if (updateInstallRequested) return;
  updateInstallRequested = true;
  isQuitting = true;
  if (vpnProcess || vpnStatus.state === 'connected') await disconnectVpn().catch(() => {});
  quitAfterCleanup = true;
}

async function installAppUpdate() {
  if (!updatesSupported || updateStatus.state !== 'ready') return updateStatus;
  setUpdateStatus({ state: 'installing', message: 'Closing WLSAPlus and installing the update...', percent: 100 });
  await cleanupBeforeUpdate();
  autoUpdater.quitAndInstall(false, true);
  return updateStatus;
}

function configureAppUpdater() {
  if (!updatesSupported) return;
  configureUpdateFeed('mirror');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('update-available', (info) => setUpdateStatus({ state: 'available', message: `WLSAPlus ${info.version} is available.`, version: info.version, percent: null }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'up-to-date', message: 'WLSAPlus is up to date.', version: null, percent: null }));
  autoUpdater.on('download-progress', (progress) => {
    const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
    setUpdateStatus({ state: 'downloading', message: `Downloading update: ${percent}%`, percent });
  });
  autoUpdater.on('update-downloaded', (info) => setUpdateStatus({ state: 'ready', message: `WLSAPlus ${info.version} is ready to install.`, version: info.version, percent: 100 }));
  autoUpdater.on('error', (error) => {
    if (updateStatus.state !== 'installing') setUpdateStatus({ state: 'error', message: updaterErrorMessage(error), percent: null });
  });
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

function createMainWindow(route = '') {
  mainWindow = new BrowserWindow({ width: 1220, height: 820, minWidth: 380, minHeight: 600, backgroundColor: '#f7f8fa', title: 'WLSAPlus', icon: iconPath(), webPreferences: webPreferences() });
  mainWindow.loadURL(appUrl(route));
}

function showMainWindow(route = '') {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(route);
    return;
  }
  if (route) void mainWindow.loadURL(appUrl(route));
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
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
ipcMain.handle('cards:close-all', () => closeAllCards(cards));
ipcMain.handle('vpn:status', () => vpnStatus);
ipcMain.handle('vpn:connect', (_event, mode) => connectVpn(mode));
ipcMain.handle('vpn:disconnect', () => disconnectVpn());
ipcMain.handle('vpn:restart-elevated', (_event, mode) => restartVpnElevated(normalizeVpnMode(mode)));
ipcMain.handle('updater:status', () => updateStatus);
ipcMain.handle('updater:check', () => checkForAppUpdate());
ipcMain.handle('updater:download', () => downloadAppUpdate());
ipcMain.handle('updater:install', () => installAppUpdate());
ipcMain.handle('translator:translate', (_event, text, source, target) => translateText(text, source, target));
ipcMain.handle('translator:capture-region', (event) => captureScreenRegion(event));

if (hasSingleInstanceLock && !isSquirrelEvent) {
  app.on('second-instance', (_event, commandLine) => {
    if (commandLine.includes('--prepare-update')) {
      void cleanupBeforeUpdate().finally(() => app.quit());
      return;
    }
    if (!commandLine.includes('--autostart')) showMainWindow();
  });
}

app.whenReady().then(async () => {
  if (isSquirrelEvent || !hasSingleInstanceLock) return;
  if (process.platform === 'win32') app.setAppUserModelId('cn.org.wlsash.wlsaplus');
  if (prepareUpdateMode) {
    await cleanupBeforeUpdate();
    app.quit();
    return;
  }
  configureAppUpdater();
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
  if (!isAutostart || cards.size === 0 || vpnAutoConnectMode) showMainWindow(vpnAutoConnectMode ? 'tools/vpn' : '');
  if (vpnAutoConnectMode) void connectVpn(vpnAutoConnectMode);
  if (updatesSupported && !vpnAutoConnectMode) {
    const updateTimer = setTimeout(() => void checkForAppUpdate(), 8_000);
    updateTimer.unref();
  }
  app.on('activate', showMainWindow);
});
app.on('before-quit', (event) => {
  isQuitting = true;
  if ((vpnProcess || vpnStatus.state === 'connected') && !quitAfterCleanup) {
    event.preventDefault();
    void disconnectVpn().finally(() => { quitAfterCleanup = true; app.quit(); });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
