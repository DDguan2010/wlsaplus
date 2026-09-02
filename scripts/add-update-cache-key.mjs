import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dump, load } from 'js-yaml';

function cacheKeyUrl(value, cacheKey) {
  if (typeof value !== 'string' || !value) throw new Error('Update metadata contains an invalid file URL.');
  const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
  const url = new URL(value, 'https://updates.invalid/');
  url.searchParams.set('build', cacheKey);
  return absolute ? url.href : `${url.pathname.replace(/^\//, '')}${url.search}${url.hash}`;
}

export function addUpdateCacheKey(metadata, cacheKey) {
  if (!metadata || typeof metadata !== 'object' || !Array.isArray(metadata.files) || metadata.files.length === 0) {
    throw new Error('Update metadata does not contain files.');
  }
  if (typeof cacheKey !== 'string' || !/^[A-Za-z0-9._-]+$/.test(cacheKey)) {
    throw new Error('WLSAPLUS_UPDATE_CACHE_KEY must contain only letters, numbers, dots, underscores, or hyphens.');
  }

  return {
    ...metadata,
    files: metadata.files.map((file) => ({ ...file, url: cacheKeyUrl(file.url, cacheKey) })),
    ...(typeof metadata.path === 'string' ? { path: cacheKeyUrl(metadata.path, cacheKey) } : {}),
  };
}

async function main() {
  const metadataPath = process.argv[2];
  if (!metadataPath) throw new Error('Pass the path to latest.yml.');
  const metadata = load(await readFile(metadataPath, 'utf8'));
  const updated = addUpdateCacheKey(metadata, process.env.WLSAPLUS_UPDATE_CACHE_KEY ?? '');
  await writeFile(metadataPath, dump(updated, { lineWidth: -1, noRefs: true }), 'utf8');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
