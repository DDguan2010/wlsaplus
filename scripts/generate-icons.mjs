import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const png2icons = require('png2icons');
const root = process.cwd();
const source = path.join(root, 'public', 'icons', 'app-icon.svg');
const buildDir = path.join(root, 'build');
await fs.mkdir(buildDir, { recursive: true });

const master = await sharp(source).resize(1024, 1024).png().toBuffer();
await fs.writeFile(path.join(buildDir, 'icon.png'), master);
await fs.writeFile(path.join(buildDir, 'icon.ico'), png2icons.createICO(master, png2icons.BICUBIC2, 0, false, true));
await fs.writeFile(path.join(buildDir, 'icon.icns'), png2icons.createICNS(master, png2icons.BICUBIC2, 0));

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
for (const [density, size] of Object.entries(legacy)) {
  const directory = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`);
  await fs.mkdir(directory, { recursive: true });
  const png = await sharp(source).resize(size, size).png().toBuffer();
  await Promise.all([
    fs.writeFile(path.join(directory, 'ic_launcher.png'), png),
    fs.writeFile(path.join(directory, 'ic_launcher_round.png'), png),
  ]);
}

const foregroundSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <path d="M23 38l10 39 14-26 14 26 10-39" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="square" stroke-linejoin="round"/>
  <path d="M83 20v23M71.5 31.5h23" fill="none" stroke="#b9eaf4" stroke-width="7" stroke-linecap="square"/>
</svg>`;
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
for (const [density, size] of Object.entries(adaptive)) {
  const target = path.join(root, 'android', 'app', 'src', 'main', 'res', `mipmap-${density}`, 'ic_launcher_foreground.png');
  await fs.writeFile(target, await sharp(Buffer.from(foregroundSvg)).resize(size, size).png().toBuffer());
}

console.log('Generated desktop and Android application icons.');
