# Phone Relay Worker

This is a separate service from the PowerSchool API. The Windows and Android
apps use it automatically when direct Wi-Fi ADB cannot connect. Users do not
need a Cloudflare account, a VPN account, or a server of their own.

## Maintainer Deployment

Use Node.js 22.22.3 or newer and a Cloudflare account with Workers, Durable
Objects, and the configured domain. From this directory:

```text
npm ci
npx wrangler login
npm test
npm run deploy
```

`wrangler.toml` creates `wlsaplus-phone-relay`, its `PhoneRoom` Durable Object
class, and the custom domain `phonewlsaplus.02studio.xyz`. Do not reuse the
PowerSchool Worker. An externally managed DNS record at the same hostname must
be resolved before Cloudflare can attach a custom domain. No pairing secrets or
Cloudflare API tokens are embedded in the app or repository.

Verify `https://phonewlsaplus.02studio.xyz/health` returns protocol `2`. The
default URL is compiled into `phone-network/phonebridge/connection.go`; changing
it requires rebuilding both clients. There is intentionally no end-user relay
selector.

## Tests

```text
npm test
npm run test:native
```

The first command tests the actual Worker in Miniflare. The second starts a local
Worker and tests both Go bridges, USB-style approval, mutual TLS, multiplexed
stream integrity and revocation against a temporary loopback echo service.
It needs Go on PATH, `WLSAPLUS_GO`, or the app's local Go toolchain.

To check a deployed service, set `WLSA_TEST_RELAY_URL` to its HTTPS origin and run
`go test ./phonebridge -run TestCloudflareRelayIntegration -count=1 -v -timeout=60s`
from `phone-network`. This uses synthetic temporary identities, not a real phone.

## Protocol And Operations

- Native clients open WSS at `/v2/rooms/{room}/{phone|desktop}` with protocol 2
  and a derived bearer credential. Browser origins are refused.
- A room ID and its bearer token are independently derived from the USB secret.
  The room stores only a hash of the bearer credential. It is not a general
  host proxy and has no public ADB listener.
- After a small readiness message, the Worker forwards binary ciphertext.
  Mutual TLS 1.3 inside WSS pins role-specific peer keys; the Worker never
  receives the pairing secret, TLS keys or plaintext ADB/video/audio.
- Room IDs are unguessable capabilities, not authenticated customer accounts.
  Rate and size limits reduce abuse but cannot prevent all distributed abuse.
  Operators should monitor Cloudflare usage and configure billing alerts.
- Limits: 240 upgrade requests/minute/IP, 64 KiB/frame, 4 MiB/second and
  1,024 messages/second per sender. Healthy sessions have no lifetime byte limit
  or forced two-hour expiry. A two-hour cleanup alarm retains rooms with active
  sockets and removes unused rooms. Closing one side closes its counterpart;
  clients reconnect with bounded exponential backoff. Windows retries mirroring
  after an unexpected device disconnect, with a Cancel button and bounded attempts.
- Hibernatable WebSockets are used, but active forwarding still incurs Durable
  Object requests, compute/storage and any applicable Cloudflare charges.
  Logging is disabled. Cloudflare can see connection metadata and traffic size.
- Relay performance depends on both networks and the selected Cloudflare
  location. This is not guaranteed to be faster than every VPN, and cannot work
  on a network that blocks this service. A real two-device latency/soak test is
  required before claiming better mirroring performance.

Releases test the Worker locally, but do not deploy it automatically. Deploy
compatible Worker updates first, then release the clients.
