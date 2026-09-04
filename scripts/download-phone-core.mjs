import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import extract from 'extract-zip';

const VERSION = '4.1';
const ARCHIVE_NAME = `scrcpy-win64-v${VERSION}.zip`;
const ARCHIVE_SHA256 = '5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db';
const root = path.resolve(import.meta.dirname, '..');
const destination = path.join(root, 'build', 'phone-core');
const executablePath = path.join(destination, 'scrcpy.exe');

async function runtimeWorks() {
  try {
    await Promise.all([
      fs.access(executablePath),
      fs.access(path.join(destination, 'adb.exe')),
      fs.access(path.join(destination, 'scrcpy-server')),
    ]);
    const result = spawnSync(executablePath, ['--version'], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 && `${result.stdout}${result.stderr}`.includes(`scrcpy ${VERSION}`);
  } catch {
    return false;
  }
}

async function findDirectoryContaining(directory, filename) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(directory, entry.name);
    try {
      await fs.access(path.join(candidate, filename));
      return candidate;
    } catch {
      const nested = await findDirectoryContaining(candidate, filename);
      if (nested) return nested;
    }
  }
  return null;
}

if (process.platform !== 'win32') {
  console.log('Phone control runtime is Windows-only; skipping download.');
} else if (await runtimeWorks()) {
  console.log(`scrcpy ${VERSION} ready for Windows x64`);
} else {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsaplus-phone-'));
  const archive = path.join(temporary, ARCHIVE_NAME);
  try {
    const response = await fetch(`https://github.com/Genymobile/scrcpy/releases/download/v${VERSION}/${ARCHIVE_NAME}`, {
      redirect: 'follow',
      headers: { 'User-Agent': 'WLSAPlus-build' },
    });
    if (!response.ok) throw new Error(`scrcpy download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== ARCHIVE_SHA256) throw new Error(`scrcpy archive checksum mismatch (received ${digest}).`);
    await fs.writeFile(archive, bytes);
    await extract(archive, { dir: temporary });
    const extractedDirectory = await findDirectoryContaining(temporary, 'scrcpy.exe');
    if (!extractedDirectory) throw new Error('The scrcpy archive did not contain scrcpy.exe.');

    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(extractedDirectory, destination, { recursive: true });
    if (!(await runtimeWorks())) throw new Error('The downloaded scrcpy runtime could not be verified.');
    console.log(`scrcpy ${VERSION} ready for Windows x64`);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}
