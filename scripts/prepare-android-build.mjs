import fs from 'node:fs/promises';
import path from 'node:path';

const ocrModels = path.resolve(import.meta.dirname, '..', 'dist', 'wlsaplus', 'browser', 'ocr');
await fs.rm(ocrModels, { recursive: true, force: true });
console.log('Removed Windows-only OCR models from the Android build.');
