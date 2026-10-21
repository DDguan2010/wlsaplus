# WLSAPlus subscription relay

This Worker hides the upstream subscription URL from WLSAPlus clients. It is a
subscription proxy only; it does not tunnel VPN traffic. Desktop WLSAPlus still
runs sing-box locally, and Android opens the returned profile in a compatible
VPN client. The Worker also enforces a shared 5 GB daily egress quota for
subscription responses and reads the upstream `subscription-userinfo` header to
enforce a shared 5 GB daily traffic gate. The quota resets at 00:00 UTC. The
limit is decimal 5 GB (5,000,000,000 bytes), shared by every client of this
Worker.

The traffic gate uses the provider's cumulative `upload + download` value and
counts its observed delta between requests. `/api/usage` can be polled by a
client while connected; once the provider reports 5 GB for the current UTC day,
the Worker returns HTTP 429 and stops issuing profiles. The Worker cannot
interrupt an already-running direct connection to a VPN node, because that
traffic does not pass through Cloudflare. A strict packet-level cap requires
the upstream VPN service or a relay that carries the VPN traffic itself.

The relay now requires VPN protocol version `2` (`protocol=2` or the
`X-WLSAPlus-VPN-Protocol: 2` header). Older WLSAPlus clients receive HTTP 426
and must update before connecting.

If the upstream omits `subscription-userinfo`, the Worker fails closed with
HTTP 503 instead of silently allowing unmetered access. The optional
`REQUIRE_PROVIDER_USAGE=false` setting restores the old subscription-only
fallback and should not be used when a traffic cap is required.

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
