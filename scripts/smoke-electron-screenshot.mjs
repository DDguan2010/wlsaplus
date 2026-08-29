import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

const executablePath = process.argv[2];
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'wlsaplus-ocr-'));
const launchOptions = executablePath
  ? { executablePath: path.resolve(executablePath), args: [`--user-data-dir=${userData}`] }
  : { args: ['.', `--user-data-dir=${userData}`] };

const electronApp = await electron.launch(launchOptions);
const errors = [];
electronApp.on('window', (page) => page.on('pageerror', (error) => errors.push(error.message)));

try {
  const mainWindow = await electronApp.firstWindow();
  mainWindow.on('pageerror', (error) => errors.push(error.message));
  await mainWindow.waitForLoadState('domcontentloaded');
  await mainWindow.evaluate(() => {
    sessionStorage.setItem('wlsaplus:offline', 'true');
    window.location.hash = '#/tools/translate';
  });
  await mainWindow.getByRole('button', { name: 'Translate screen' }).waitFor({ state: 'visible' });
  await mainWindow.getByRole('button', { name: 'Translate screen' }).click();

  const deadline = Date.now() + 10_000;
  let overlay;
  while (!overlay && Date.now() < deadline) {
    overlay = electronApp.windows().find((page) => page !== mainWindow && page.url().endsWith('/capture.html'));
    if (!overlay) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!overlay) throw new Error('Screen-selection overlay did not open.');

  await overlay.waitForLoadState('domcontentloaded');
  await overlay.locator('canvas').waitFor({ state: 'visible' });
  await overlay.mouse.move(80, 80);
  await overlay.mouse.down();
  await overlay.mouse.move(620, 260, { steps: 10 });
  await overlay.mouse.up();

  await mainWindow.getByText(/Recognizing|Translating|No text was recognized/).first().waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
  await mainWindow.waitForFunction(() => !document.body.textContent?.includes('Recognizing text...'), undefined, { timeout: 90_000 });
  const body = await mainWindow.locator('body').innerText();
  if (/is not a function|Screen translation failed|worker failed|network error/i.test(`${body}\n${errors.join('\n')}`)) {
    throw new Error(`Screenshot OCR failed:\n${body}\n${errors.join('\n')}`);
  }
  console.log('Electron screenshot OCR smoke test passed.');
} finally {
  await electronApp.close();
  await fs.rm(userData, { recursive: true, force: true });
}
