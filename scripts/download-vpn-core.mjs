import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import extract from 'extract-zip';

const VERSION = '1.13.19';
const PLUGIN_VERSION = '1.3.2';
const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'build', 'vpn-core');
const executableName = process.platform === 'win32' ? 'sing-box.exe' : 'sing-box';
const executablePath = path.join(destination, executableName);
const pluginExecutableName = process.platform === 'win32' ? 'v2ray-plugin.exe' : 'v2ray-plugin';
const pluginExecutablePath = path.join(destination, pluginExecutableName);

const targets = {
  'win32-x64': { core: 'windows-amd64.zip', plugin: 'windows-amd64' },
  'darwin-x64': { core: 'darwin-amd64.tar.gz', plugin: 'darwin-amd64' },
  'darwin-arm64': { core: 'darwin-arm64.tar.gz', plugin: 'darwin-arm64' },
};

async function works() {
  try {
    await fs.access(executablePath);
    await fs.access(pluginExecutablePath);
    const coreResult = spawnSync(executablePath, ['version'], { encoding: 'utf8', windowsHide: true });
    const pluginResult = spawnSync(pluginExecutablePath, ['-version'], { encoding: 'utf8', windowsHide: true });
    return coreResult.status === 0
      && `${coreResult.stdout}${coreResult.stderr}`.includes(VERSION)
      && pluginResult.status === 0
      && `${pluginResult.stdout}${pluginResult.stderr}`.includes(PLUGIN_VERSION);
  } catch { return false; }
}

async function findFile(directory, name) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) { const nested = await findFile(candidate, name); if (nested) return nested; }
    else if (entry.name === name) return candidate;
  }
  return null;
}

async function findPluginFile(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await findPluginFile(candidate);
      if (nested) return nested;
    } else if (entry.name.toLowerCase().startsWith('v2ray-plugin') && !entry.name.endsWith('.tar.gz')) {
      return candidate;
    }
  }
  return null;
}

const target = targets[`${process.platform}-${process.arch}`];
if (!target) {
  throw new Error(`No VPN core is configured for ${process.platform}-${process.arch}.`);
}

if (!(await works())) {
  const suffix = target.core;
  const archiveName = `sing-box-${VERSION}-${suffix}`;
  const releaseUrl = `https://github.com/SagerNet/sing-box/releases/download/v${VERSION}/${archiveName}`;
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsaplus-vpn-'));
  const archive = path.join(temporary, archiveName);
  const pluginArchiveName = `v2ray-plugin-${target.plugin}-v${PLUGIN_VERSION}.tar.gz`;
  const pluginArchive = path.join(temporary, pluginArchiveName);
  const pluginExtractDirectory = path.join(temporary, 'plugin');
  try {
    const response = await fetch(releaseUrl, { redirect: 'follow', headers: { 'User-Agent': 'WLSAPlus-build' } });
    if (!response.ok) throw new Error(`VPN core download failed with ${response.status}.`);
    await fs.writeFile(archive, Buffer.from(await response.arrayBuffer()));
    if (suffix.endsWith('.zip')) await extract(archive, { dir: temporary });
    else {
      const result = spawnSync('tar', ['-xzf', archive, '-C', temporary], { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr || 'Could not extract the VPN core.');
    }
    const extracted = await findFile(temporary, executableName);
    if (!extracted) throw new Error('The VPN core archive did not contain an executable.');

    const pluginResponse = await fetch(`https://github.com/shadowsocks/v2ray-plugin/releases/download/v${PLUGIN_VERSION}/${pluginArchiveName}`, { redirect: 'follow', headers: { 'User-Agent': 'WLSAPlus-build' } });
    if (!pluginResponse.ok) throw new Error(`VPN plugin download failed with ${pluginResponse.status}.`);
    await fs.writeFile(pluginArchive, Buffer.from(await pluginResponse.arrayBuffer()));
    await fs.mkdir(pluginExtractDirectory, { recursive: true });
    const pluginExtractResult = spawnSync('tar', ['-xzf', pluginArchive, '-C', pluginExtractDirectory], { encoding: 'utf8' });
    if (pluginExtractResult.status !== 0) throw new Error(pluginExtractResult.stderr || 'Could not extract the VPN plugin.');
    const extractedPlugin = await findPluginFile(pluginExtractDirectory);
    if (!extractedPlugin) throw new Error('The VPN plugin archive did not contain an executable.');

    await fs.mkdir(destination, { recursive: true });
    await fs.copyFile(extracted, executablePath);
    await fs.copyFile(extractedPlugin, pluginExecutablePath);
    if (process.platform !== 'win32') {
      await fs.chmod(executablePath, 0o755);
      await fs.chmod(pluginExecutablePath, 0o755);
    }
    const licenseResponse = await fetch(`https://raw.githubusercontent.com/SagerNet/sing-box/v${VERSION}/LICENSE`);
    if (licenseResponse.ok) await fs.writeFile(path.join(destination, 'LICENSE-sing-box.txt'), await licenseResponse.text());
    const pluginLicenseResponse = await fetch(`https://raw.githubusercontent.com/shadowsocks/v2ray-plugin/v${PLUGIN_VERSION}/LICENSE`);
    if (pluginLicenseResponse.ok) await fs.writeFile(path.join(destination, 'LICENSE-v2ray-plugin.txt'), await pluginLicenseResponse.text());
    if (!(await works())) throw new Error('The downloaded VPN core could not be verified.');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

console.log(`sing-box ${VERSION} and v2ray-plugin ${PLUGIN_VERSION} ready for ${process.platform}-${process.arch}`);
