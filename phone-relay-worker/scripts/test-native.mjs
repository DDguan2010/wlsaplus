import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundled = path.join(root, 'output/toolchains/go/bin/go.exe');
const go = process.env.WLSAPLUS_GO || (existsSync(bundled) ? bundled : 'go');
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, modules: true, scriptPath: fileURLToPath(new URL('../src/worker.js', import.meta.url)), compatibilityDate: '2026-08-31', durableObjects: { PHONE_ROOMS: { className: 'PhoneRoom', useSQLite: true } } }));
try {
  const url = (await mf.ready).origin;
  const child = spawn(go, ['test', './phonebridge', '-run', 'TestCloudflareRelayIntegration', '-count=1', '-v', '-timeout=60s'], { cwd: path.join(root, 'phone-network'), env: { ...process.env, WLSA_TEST_RELAY_URL: url }, stdio: 'inherit', windowsHide: true });
  process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
} finally { await mf.dispose(); }
