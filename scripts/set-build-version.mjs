import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const version = (process.env.WLSAPLUS_VERSION ?? '').trim().replace(/^v/, '');
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

if (!semverPattern.test(version)) {
  throw new Error('WLSAPLUS_VERSION must be a semantic version such as 1.2.0 or 1.2.0-beta.1.');
}

async function updateJson(relativePath, update) {
  const file = path.join(root, relativePath);
  const contents = JSON.parse(await fs.readFile(file, 'utf8'));
  update(contents);
  await fs.writeFile(file, `${JSON.stringify(contents, null, 2)}\n`);
}

await updateJson('package.json', (packageJson) => {
  packageJson.version = version;
});

await updateJson('package-lock.json', (packageLock) => {
  packageLock.version = version;
  if (packageLock.packages?.['']) packageLock.packages[''].version = version;
});

await fs.writeFile(
  path.join(root, 'src', 'app', 'build-info.ts'),
  `// Updated by scripts/set-build-version.mjs for release builds.\nexport const BUILD_VERSION = '${version}';\n`,
);

console.log(`Applied WLSAPlus version ${version}.`);
