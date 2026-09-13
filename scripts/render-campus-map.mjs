// Export the actual Angular SVG template, so the preview cannot drift from the app.
import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = resolve(root, 'src/app/shared/campus-map.svg');
const output = resolve(root, 'output');
await mkdir(output, { recursive: true });
await copyFile(source, resolve(output, 'wlsa-campus-map.svg'));
const svg = await readFile(source);
await sharp(svg, { density: 144 }).png().toFile(resolve(output, 'wlsa-campus-map.png'));

// Optional: a side-by-side comparison with the supplied 1700×1280 map photograph.
const reference = process.argv[2];
if (reference) {
  const photo = await sharp(resolve(reference)).extract({ left: 0, top: 160, width: 1700, height: 800 }).png().toBuffer();
  const drawing = await sharp(svg).resize(1700, 800).png().toBuffer();
  const headings = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="3460" height="60"><rect width="3460" height="60" fill="#ffffff"/><g font-family="Arial,sans-serif" font-size="25" fill="#26342c"><text x="20" y="38">Official map reference</text><text x="1750" y="38">WLSAPlus SVG (same source used in the app)</text></g></svg>');
  await sharp({ create: { width: 3460, height: 880, channels: 4, background: '#ffffff' } })
    .composite([{ input: headings, left: 0, top: 0 }, { input: photo, left: 20, top: 60 }, { input: drawing, left: 1740, top: 60 }])
    .png().toFile(resolve(output, 'wlsa-campus-map-comparison.png'));
}
console.log(`Map preview: ${resolve(output, 'wlsa-campus-map.png')}`);
