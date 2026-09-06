import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeNetworkNotices(go, cwd, destination) {
  const result = spawnSync(go, ['run', './cmd/notices', go], { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Cannot collect native component license notices: ${result.stderr}`);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, result.stdout);
}
