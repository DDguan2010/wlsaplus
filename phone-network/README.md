# Embedded Phone Connection

Windows tries direct ADB over Wi-Fi first. If it fails, WLSAPlus automatically
uses its Cloudflare WebSocket relay. Android runs a foreground connection
service. No VPN app, account sign-in or transport choice is required. The relay
is operated by the app maintainer; see `../phone-relay-worker/README.md` for
deployment, security limits and operating costs.

## User Flow

1. Install the updated Android and Windows apps. On Android enable developer
   options and USB debugging, unlock the phone, then connect a trusted USB cable.
2. In Windows open Tools > Phone control > Connect by USB and accept Android's
   USB debugging prompt. Direct Wi-Fi is attempted first.
3. If needed, Windows opens Android's Connect to computer page. Tap Enable
   connection and approve the six-digit code only when it matches Windows.
4. Keep USB connected until the mirror opens. Then unplug it. Use Open wirelessly
   next time, with Android's connection still enabled. After a phone reboot,
   reconnect USB to restore Android debugging.

Both devices need internet for relay mode. Same-Wi-Fi client isolation does not
prevent outbound HTTPS/WSS by itself, but firewalls can still block the relay.
Old Tailscale pairings require fresh USB approval. School credentials, tasks and
the protected host identity are preserved. There is no account to switch;
Forget on both devices lets the user pair a different phone/computer.

## Build And Test

Prerequisites: Node.js as specified in the root package, Go 1.27.1. Android also
requires JDK 21, Android SDK platform/build-tools 36, and NDK 28.2.13676358.
Set `JAVA_HOME`, `ANDROID_HOME`, `ANDROID_NDK_HOME` for local Android builds.
Set `WLSAPLUS_GO` if Go is not on PATH.

From the app root:

```text
npm run phone:network
npm run phone:network:android
npm run android:build
```

Windows produces `build/phone-core/phone-network.exe`. Android produces
`android/app/libs/phone-network.aar` for arm64-v8a, armeabi-v7a and x86_64.
Windows development/package commands build the helper automatically. The release
workflow builds both components. Web/macOS do not load the native helper.

Run `go test ./...` and `go vet ./...` here, or `go test -race ./...` with a
supported C compiler. Root `npm test` covers Windows pairing and automatic
fallback. Run `npm run test:native` in `phone-relay-worker` for a complete local
Worker/native integration test without a phone.

`PhoneNetworkStartupTest` is an on-device startup check using temporary state:

```text
cd android
gradlew.bat :app:connectedDebugAndroidTest -PwlsaPhonePreview -Pandroid.testInstrumentationRunnerArguments.class=cn.org.wlsash.wlsaplus.PhoneNetworkStartupTest
```

This installs/updates only the phone-preview variant and its test runner.

## Trust And Lifecycle

- Authorized USB ADB forwards only the phone's loopback pairing port 37183.
  Browser origins are refused, but local native programs still need a visible
  matching-code approval during a three-minute pairing window.
- The Windows-generated 256-bit pairing secret is carried over USB and stored
  using Electron safeStorage / Android Keystore-backed AES-GCM state storage.
- HKDF derives distinct bearer and role-specific Ed25519 keys. Mutual TLS 1.3
  pins the opposite role's public key, inside WSS. Cloudflare cannot authenticate
  as a device or read its ADB stream with the relay credential alone.
- Yamux multiplexes streams inside TLS. Android forwards only to its loopback
  ADB listener on port 5555. Windows exposes only a loopback endpoint.
- Android must explicitly enable the foreground service. It has Stop, visible
  approval, and Forget actions. No boot start or silent re-pairing is implemented.
  Stop cuts relay streams; Forget also deletes trust. Closing a mirror alone
  does not revoke pairing. Direct Wi-Fi ADB is independent of this service.
- USB setup enables Android's normal network ADB listener. Android's ADB key
  authorization remains mandatory. Disable USB debugging when finished; never
  expose port 5555 through a router. The app's Stop action does not disable ADB.
- Windows retries only the selected offline USB/ADB transport, does not kill
  the shared ADB server, and always removes temporary pairing forwards.
- Relay mirroring uses 1280px, 30fps and 2 Mbps video to limit congestion.
  Direct Wi-Fi retains its existing quality. Relay reconnection may require
  Open wirelessly; audio capture depends on Android version and the source app.

## Device Acceptance Checks

Automated tests do not establish real-device compatibility. Before publishing:

1. Test direct Wi-Fi, then isolated Wi-Fi fallback and matching-code approval.
2. Unplug USB after the mirror opens. Test touch, keyboard, screen-off, audio,
   app restart, phone reboot, interrupted pairing, and a different phone.
3. Stop/Forget must cut relay mirroring and prevent the old pair reconnecting.
   Confirm other users' pairs stay isolated.
4. Test network loss/recovery, blocked relay, long sessions, Android background
   battery restrictions, repeated Enable/Stop, and cancellation during setup.

The relay requires no VPS but is still a hosted service with cost and capacity
limits. It cannot guarantee passage through every managed network.
