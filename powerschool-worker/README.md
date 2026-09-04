# WLSAPlus PowerSchool gateway

This Worker is a session-aware reverse proxy for the WLSA PowerSchool host. It is intentionally not a general URL proxy.

## Deploy

1. Sign in to Cloudflare from this directory with `npx wrangler login`.
2. Ensure `02studio.xyz` is in the same Cloudflare account.
3. Run `npm install` and then `npm run deploy`.
4. Check `https://apiwlsaplus.02studio.xyz/health` returns `{"ok":true}`.

The first deployment creates the `PowerSchoolSession` Durable Object namespace and connects the custom domain from `wrangler.toml`.

## Browser request format

Keep the upstream path after `/api/powerschool` and include credentials on every request:

```js
const response = await fetch(
  'https://apiwlsaplus.02studio.xyz/api/powerschool/guardian/myschedule.html',
  {
    method: 'GET',
    credentials: 'include',
  },
);
const html = await response.text();
```

POST bodies and `Content-Type` are forwarded in the same way. Query parameters and upstream response status/body are preserved. PowerSchool `Set-Cookie` values stay inside the Durable Object.

To discard the session:

```js
await fetch('https://apiwlsaplus.02studio.xyz/api/powerschool/logout', {
  method: 'POST',
  credentials: 'include',
});
```

Only `https://wlsap.02studio.xyz` is allowed by default. For local development, temporarily add the exact local origin to `ALLOWED_ORIGINS`, separated by a comma. Do not use `*` with credentialed requests.

Routes are restricted to `/public/`, `/guardian/`, and the assignment lookup namespace at `/ws/xte/assignment/`. Add another narrow prefix to `ALLOWED_PATH_PREFIXES` only when the app actually needs it. Configure an IP-based Cloudflare rate-limit rule for the custom domain in addition to the included per-session limit.
