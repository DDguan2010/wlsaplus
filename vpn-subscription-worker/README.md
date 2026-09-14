# WLSAPlus subscription relay

This Worker hides the upstream subscription URL from WLSAPlus clients. It is a
subscription proxy only; it does not tunnel VPN traffic. Desktop WLSAPlus still
runs sing-box locally, and Android opens the returned profile in a compatible
VPN client.

## Deploy

From this directory, authenticate with Wrangler and set the upstream as a
secret. Rotate the subscription URL first because it was previously shared in
chat:

```powershell
npx wrangler login
npx wrangler secret put UPSTREAM_SUBSCRIPTION_URL
npx wrangler deploy
```

Optionally protect the endpoint from casual third-party use:

```powershell
npx wrangler secret put SUBSCRIPTION_ACCESS_KEY
```

The included `wrangler.toml` attaches the Worker to
`vpnrelay.02studio.xyz`. The DNS zone must be in the same Cloudflare account.
If you choose another hostname, update both that route and the app source
definitions before building WLSAPlus.
