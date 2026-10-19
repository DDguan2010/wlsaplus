# WLSAPlus subscription relay

This Worker hides the upstream subscription URL from WLSAPlus clients. It is a
subscription proxy only; it does not tunnel VPN traffic. Desktop WLSAPlus still
runs sing-box locally, and Android opens the returned profile in a compatible
VPN client. The Worker also enforces a shared 20 GB daily egress quota for
subscription responses. The quota resets at 00:00 UTC. The limit is decimal
20 GB (20,000,000,000 bytes), shared by every client of this Worker.

This quota counts bytes returned by this Worker while downloading the
subscription configuration. It does **not** count traffic sent later from a
client directly to the VPN nodes in that configuration. A real per-user VPN
traffic quota must be enforced by the upstream VPN service or a relay that
handles the VPN traffic itself.

## Deploy

From this directory, authenticate with Wrangler and set the upstream as a
secret. Rotate the subscription URL first because it was previously shared in
chat:

```powershell
npx wrangler login
npx wrangler secret put UPSTREAM_SUBSCRIPTION_URL
npx wrangler deploy
```

The first deploy after adding the quota creates the `DailyQuota` Durable Object
namespace and migration. No new secret is required.

Optionally protect the endpoint from casual third-party use:

```powershell
npx wrangler secret put SUBSCRIPTION_ACCESS_KEY
```

The included `wrangler.toml` attaches the Worker to
`vpnrelay.02studio.xyz`. The DNS zone must be in the same Cloudflare account.
If you choose another hostname, update both that route and the app source
definitions before building WLSAPlus.
