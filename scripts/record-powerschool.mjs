import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { chromium } from 'playwright';

const DEFAULT_DURATION_SECONDS = 90;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const BODY_RESOURCE_TYPES = new Set(['document', 'fetch', 'xhr', 'other']);
const SECRET_HEADER = /^(authorization|cookie|proxy-authorization|set-cookie|x-api-key|x-auth-token|x-csrf-token|x-xsrf-token)$/i;
const SECRET_FIELD = /^(dbpw|pw|translatorpw|translator_ldappassword)$|(^|[_-])(account|email|login|pass|password|passwd|pw|pwd|secret|session|sessionid|token|user|username|xsrf|csrf|samlresponse|assertion)($|[_-])/i;
const SECRET_QUERY_FIELD = /^(account|auth|authorization|code|dbpw|email|login|password|passwd|pw|pwd|samlresponse|session|state|ticket|token|translatorpw|user|username|xsrf|csrf)$/i;

const args = parseArgs(process.argv.slice(2));
const durationSeconds = parseDuration(args.duration);
const schoolUrl = await getSchoolUrl(args.url);
const startedAt = new Date();
const captureName = startedAt.toISOString().replaceAll(':', '-').replaceAll('.', '-');
const captureDir = new URL(`../captures/powerschool-${captureName}/`, import.meta.url);
const bodiesDir = new URL('bodies/', captureDir);

await mkdir(bodiesDir, { recursive: true });

console.log('\nWLSAPlus PowerSchool network recorder');
console.log('-------------------------------------');
console.log(`Target:   ${schoolUrl}`);
console.log(`Duration: ${durationSeconds} seconds`);
console.log(`Output:   ${fileURLToPath(captureDir)}`);
console.log('\nThe browser uses a temporary profile. Enter credentials only in the browser.');
console.log('Passwords, cookies and common authentication tokens are redacted from the capture.');
console.log('Course, teacher and student data in response bodies may still be present locally.\n');

let browser;
try {
  browser = await chromium.launch({
    headless: false,
    args: ['--start-maximized'],
  });
} catch (error) {
  if (String(error).includes('Executable doesn\'t exist')) {
    console.error('Chromium is not installed. Run: npx playwright install chromium');
    process.exitCode = 1;
    process.exit();
  }
  throw error;
}

const context = await browser.newContext({
  acceptDownloads: false,
  ignoreHTTPSErrors: false,
  viewport: null,
});
const page = await context.newPage();
const requestIds = new WeakMap();
const entries = [];
const pendingResponses = new Set();
let nextRequestId = 1;
let stopped = false;

context.on('request', (request) => {
  const id = nextRequestId++;
  requestIds.set(request, id);
  entries.push({
    id,
    startedMs: Date.now() - startedAt.getTime(),
    method: request.method(),
    url: sanitizeUrl(request.url()),
    resourceType: request.resourceType(),
    navigationRequest: request.isNavigationRequest(),
    redirectedFromId: request.redirectedFrom() ? requestIds.get(request.redirectedFrom()) ?? null : null,
    requestHeaders: sanitizeHeaders(request.headers()),
    requestBody: sanitizeRequestBody(request.postData(), request.headers()['content-type']),
    response: null,
    failure: null,
  });
});

context.on('requestfailed', (request) => {
  const entry = findEntry(requestIds.get(request));
  if (entry) {
    entry.failure = request.failure()?.errorText ?? 'Request failed';
  }
});

context.on('response', (response) => {
  const task = captureResponse(response).finally(() => pendingResponses.delete(task));
  pendingResponses.add(task);
});

await page.goto(schoolUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch((error) => {
  console.warn(`Initial navigation did not fully complete: ${error.message}`);
});

const recordingStartedAt = Date.now();

console.log('Recording started. In the browser, complete these actions:');
console.log('  1. Sign in to PowerSchool.');
console.log('  2. Open the current schedule.');
console.log('  3. Open one course and return to the schedule.');
console.log('  4. Change the displayed week or term if PowerSchool allows it.');
console.log('\nRecording stops automatically. You may also close the browser to stop early.\n');

const countdown = setInterval(() => {
  const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000);
  const remaining = Math.max(0, durationSeconds - elapsed);
  stdout.write(`\rRecording: ${String(remaining).padStart(3)} seconds remaining `);
}, 1000);

let stopTimer;
await Promise.race([
  new Promise((resolve) => {
    stopTimer = setTimeout(resolve, durationSeconds * 1000);
  }),
  new Promise((resolve) => browser.once('disconnected', resolve)),
]);

stopped = true;
clearTimeout(stopTimer);
clearInterval(countdown);
stdout.write('\rRecording stopped. Saving capture...          \n');

await Promise.allSettled([...pendingResponses]);
if (browser.isConnected()) {
  await browser.close();
}

const completedAt = new Date();
const sortedEntries = entries.sort((a, b) => a.id - b.id);
const apiCandidates = sortedEntries.filter((entry) =>
  ['fetch', 'xhr'].includes(entry.resourceType) ||
  isStructuredContentType(entry.response?.contentType),
);

await writeJson(new URL('requests.json', captureDir), sortedEntries);
await writeJson(new URL('summary.json', captureDir), {
  formatVersion: 1,
  recorder: 'WLSAPlus PowerSchool network recorder',
  startedAt: startedAt.toISOString(),
  completedAt: completedAt.toISOString(),
  durationSeconds: Math.round((completedAt.getTime() - recordingStartedAt) / 1000),
  targetOrigin: new URL(schoolUrl).origin,
  requestCount: sortedEntries.length,
  responseCount: sortedEntries.filter((entry) => entry.response).length,
  failedRequestCount: sortedEntries.filter((entry) => entry.failure).length,
  apiCandidateCount: apiCandidates.length,
  apiCandidates: apiCandidates.map((entry) => ({
    id: entry.id,
    method: entry.method,
    status: entry.response?.status ?? null,
    resourceType: entry.resourceType,
    contentType: entry.response?.contentType ?? null,
    url: entry.url,
    bodyFile: entry.response?.bodyFile ?? null,
  })),
  securityNote: 'Secret headers and common credential fields were redacted. Response bodies can still contain personal school data.',
});

console.log(`Saved ${sortedEntries.length} requests (${apiCandidates.length} API candidates).`);
console.log(`Capture directory: ${fileURLToPath(captureDir)}`);
console.log('Do not publish or commit this directory.');

async function captureResponse(response) {
  if (stopped) return;

  const request = response.request();
  const entry = findEntry(requestIds.get(request));
  if (!entry) return;

  entry.requestHeaders = sanitizeHeaders(
    await request.allHeaders().catch(() => request.headers()),
  );
  const headers = await response.allHeaders().catch(() => response.headers());
  const contentType = headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? null;
  const contentLength = Number(headers['content-length'] ?? 0);
  entry.response = {
    status: response.status(),
    statusText: response.statusText(),
    contentType,
    headers: sanitizeHeaders(headers),
    bodyBytes: null,
    bodySha256: null,
    bodyFile: null,
    bodySkippedReason: null,
  };

  if (!shouldCaptureBody(entry.resourceType, contentType, contentLength, response.status())) {
    entry.response.bodySkippedReason = contentLength > MAX_BODY_BYTES
      ? `Body exceeds ${MAX_BODY_BYTES} bytes`
      : 'Static, binary or empty response';
    return;
  }

  try {
    const body = await response.body();
    if (body.length > MAX_BODY_BYTES) {
      entry.response.bodySkippedReason = `Body exceeds ${MAX_BODY_BYTES} bytes`;
      return;
    }

    const text = body.toString('utf8');
    const sanitized = sanitizeResponseText(text, contentType);
    const extension = bodyExtension(contentType);
    const bodyFile = `bodies/${String(entry.id).padStart(4, '0')}.${extension}`;
    await writeFile(new URL(bodyFile, captureDir), sanitized, 'utf8');
    entry.response.bodyBytes = Buffer.byteLength(sanitized);
    entry.response.bodySha256 = createHash('sha256').update(sanitized).digest('hex');
    entry.response.bodyFile = bodyFile;
  } catch (error) {
    entry.response.bodySkippedReason = `Unable to read response body: ${error.message}`;
  }
}

function findEntry(id) {
  return id ? entries.find((entry) => entry.id === id) : null;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) continue;
    const [rawKey, inlineValue] = value.slice(2).split('=', 2);
    parsed[rawKey] = inlineValue ?? values[++index];
  }
  return parsed;
}

function parseDuration(rawDuration) {
  if (rawDuration === undefined) return DEFAULT_DURATION_SECONDS;
  const duration = Number(rawDuration);
  if (!Number.isInteger(duration) || duration < 15 || duration > 600) {
    throw new Error('--duration must be an integer from 15 to 600 seconds.');
  }
  return duration;
}

async function getSchoolUrl(rawUrl) {
  let value = rawUrl;
  if (!value) {
    const readline = createInterface({ input: stdin, output: stdout });
    value = await readline.question('PowerSchool login URL: ');
    readline.close();
  }

  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      throw new Error('PowerSchool URL must use HTTPS.');
    }
    return url.href;
  } catch (error) {
    throw new Error(`Invalid PowerSchool URL: ${error.message}`);
  }
}

function sanitizeHeaders(headers) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [
    name,
    sanitizeHeaderValue(name, value),
  ]));
}

function sanitizeHeaderValue(name, value) {
  if (!SECRET_HEADER.test(name)) return value;
  if (/^authorization$/i.test(name)) {
    const scheme = value.match(/^\S+/)?.[0];
    return scheme ? `${scheme} [REDACTED]` : '[REDACTED]';
  }
  if (/^cookie$/i.test(name)) {
    return value
      .split(';')
      .map((part) => `${part.split('=', 1)[0].trim()}=[REDACTED]`)
      .join('; ');
  }
  if (/^set-cookie$/i.test(name)) {
    return value
      .split('\n')
      .map((cookie) => cookie.replace(/^([^=;]+)=([^;]*)/, '$1=[REDACTED]'))
      .join('\n');
  }
  return '[REDACTED]';
}

function sanitizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    for (const key of url.searchParams.keys()) {
      if (SECRET_QUERY_FIELD.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    return url.href;
  } catch {
    return rawUrl;
  }
}

function sanitizeRequestBody(body, contentType = '') {
  if (!body) return null;
  if (contentType.includes('application/json')) {
    return sanitizeJsonText(body);
  }
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const values = new URLSearchParams(body);
    for (const key of values.keys()) {
      if (SECRET_FIELD.test(key)) values.set(key, '[REDACTED]');
    }
    return values.toString();
  }
  if (contentType.includes('multipart/form-data')) {
    return '[REDACTED multipart request body]';
  }
  return redactTextSecrets(body);
}

function sanitizeResponseText(text, contentType = '') {
  if (contentType?.includes('json')) return sanitizeJsonText(text);
  return redactTextSecrets(text);
}

function sanitizeJsonText(text) {
  try {
    return JSON.stringify(redactObject(JSON.parse(text)), null, 2);
  } catch {
    return redactTextSecrets(text);
  }
}

function redactObject(value) {
  if (Array.isArray(value)) return value.map(redactObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    SECRET_FIELD.test(key) ? '[REDACTED]' : redactObject(child),
  ]));
}

function redactTextSecrets(text) {
  return text
    .replace(/([?&](?:account|auth|dbpw|email|login|password|passwd|pw|pwd|samlresponse|session|ticket|token|translatorpw|user|username|xsrf|csrf)=)[^&#"'\s<>]*/gi, '$1[REDACTED]')
    .replace(/((?:"|')?(?:account|auth|dbpw|email|login|password|passwd|pw|pwd|secret|sessionid|token|translatorpw|user|username|xsrf|csrf)(?:"|')?\s*[:=]\s*(?:"|'))[^"']*/gi, '$1[REDACTED]')
    .replace(/((?:dbpw|password|passwd|pw|pwd|token|secret|sessionid|translatorpw|username|email|csrf|xsrf)\s*[=:]\s*)[^&\s"'<>]+/gi, '$1[REDACTED]')
    .replace(/((?:name|id)=["'](?:account|dbpw|email|login|password|passwd|pw|pwd|token|secret|sessionid|translatorpw|user|username|csrf|xsrf)["'][^>]*?value=["'])[^"']*/gi, '$1[REDACTED]');
}

function shouldCaptureBody(resourceType, contentType, contentLength, status) {
  if ([204, 205, 304].includes(status)) return false;
  if (contentLength > MAX_BODY_BYTES) return false;
  return BODY_RESOURCE_TYPES.has(resourceType) || isStructuredContentType(contentType);
}

function isStructuredContentType(contentType) {
  return Boolean(contentType && /(json|text|html|xml|javascript|x-www-form-urlencoded)/i.test(contentType));
}

function bodyExtension(contentType) {
  if (contentType?.includes('json')) return 'json';
  if (contentType?.includes('html')) return 'html';
  if (contentType?.includes('xml')) return 'xml';
  if (contentType?.includes('javascript')) return 'js';
  return 'txt';
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
