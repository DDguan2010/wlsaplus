import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeNetworkNotices } from './phone-network-notices.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = process.argv.includes('--android');
if (!android && process.platform !== 'win32') process.exit(0);
const bundledGo = path.join(root, 'output/toolchains/go/bin/go.exe');
const go = process.env.WLSAPLUS_GO || (process.platform === 'win32' && existsSync(bundledGo) ? bundledGo : 'go');
const moduleDir = path.join(root, 'phone-network');
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: moduleDir, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Could not run ${command}. Install Go 1.27.1; Android also needs JDK 21, Android SDK and NDK 28.2.13676358. ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status || 1);
}
if (android) {
  const bin = path.join(root, 'output/phone-build-tools'); mkdirSync(bin, { recursive: true });
  const suffix = process.platform === 'win32' ? '.exe' : '';
  const env = { ...process.env, GOBIN: bin, PATH: `${path.dirname(go)}${path.delimiter}${bin}${path.delimiter}${process.env.PATH || process.env.Path || ''}` };
  const mobile = 'golang.org/x/mobile/cmd/';
  const version = '4776eadac327bcb80cebc7413c91f8b4abf8ffa1';
  run(go, ['install', `${mobile}gomobile@${version}`], env);
  run(go, ['install', `${mobile}gobind@${version}`], env);
  mkdirSync(path.join(root, 'android/app/libs'), { recursive: true });
  run(path.join(bin, `gomobile${suffix}`), ['bind', '-target=android/arm64,android/arm,android/amd64', '-androidapi=24', '-ldflags=-s -w', '-o', path.join(root, 'android/app/libs/phone-network.aar'), './phonebridge'], env);
  writeNetworkNotices(go, moduleDir, path.join(root, 'android/app/src/main/assets/phone-network/NOTICES.txt'));
} else {
  mkdirSync(path.join(root, 'build/phone-core'), { recursive: true });
  run(go, ['build', '-trimpath', '-ldflags=-s -w', '-o', path.join(root, 'build/phone-core/phone-network.exe'), './cmd/phone-network']);
  writeNetworkNotices(go, moduleDir, path.join(root, 'build/phone-core/PHONE-NETWORK-NOTICES.txt'));
}
