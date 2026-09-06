# Embedded Phone Connection

Windows tries direct ADB over Wi-Fi first. If it fails, WLSAPlus starts a private
`tsnet` node and asks for hosted Tailscale sign-in only when needed. The Android
companion runs a separate `tsnet` node in a foreground service. Each user uses
their own Tailscale account. No auth keys, shared tailnet, custom controller,
Cloudflare Worker, or developer-operated relay are included.

## Build

Prerequisites: Node.js as specified in the root package, Go 1.27.1. Android also
requires JDK 21, Android SDK platform/build-tools 36, and NDK 28.2.13676358.
Set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_NDK_HOME` for local Android builds.
Set `WLSAPLUS_GO` if Go is not on PATH.

From the app root:

```text
npm run phone:network
npm run phone:network:android
npm run android:build
```

Windows produces `build/phone-core/phone-network.exe`. Android produces
`android/app/libs/phone-network.aar` for arm64-v8a, armeabi-v7a and x86_64.
The normal Windows development/package commands build the helper automatically.
The release workflow builds both native components. No release is triggered by
normal branch pushes. Web/macOS builds do not use the networking helper.

Tests from this directory: `go test ./...`; use `go test -race ./...` on a host
with a supported C compiler. Root `npm test` includes the Windows adapter and
automatic-fallback tests.

Android network discovery must use `PhoneNetworkSnapshot` and the Tailscale
`RegisterInterfaceGetter` hook: Android 11+ denies Go's raw netlink interface
queries. The service provides a snapshot before starting tsnet and injects a
network-change event when it changes. Even address-less interfaces must provide
non-null alternate addresses to avoid falling back to a denied OS lookup.

Both hosts configure `TS_LOGS_DIR` inside private connection state before starting
tsnet. Disabling uploads alone is insufficient: the socket logger still resolves
a log directory, and Android cannot use desktop home or temporary directories.

Phone tunnels use the embedded netstack dialer exclusively. `tsnet.Server.Dial`
can fall back to the OS for an unknown peer; it must not be used for the pairing
secret or ADB traffic. Endpoint creation checks peer visibility, authentication,
and the phone's loopback debugging listener before exposing a local ADB port.
The status distinguishes an absent peer, an unreachable receiver, rejected
pairing, and disabled Android debugging. Both hosts show their Tailscale network
name, and new USB pairing rejects mismatched networks.

Windows recovers only the selected USB transport for transient offline reads,
serializes USB setup, and verifies TCP mode after an interrupted `tcpip` command.
It does not restart adbd when port 5555 is already enabled or kill the shared
ADB server. Cancellation still removes its temporary USB forwarding port.

`PhoneNetworkStartupTest` is an on-device instrumentation check for this path.
It uses temporary connection state, reaches hosted sign-in without signing in,
and stops the helper. Run it on an authorized Android device with internet access:

```text
cd android
gradlew.bat :app:connectedDebugAndroidTest -PwlsaPhonePreview -Pandroid.testInstrumentationRunnerArguments.class=cn.org.wlsash.wlsaplus.PhoneNetworkStartupTest
```

This installs/updates only the phone-preview variant and its test runner.

## Trust And Lifecycle

Both Windows Phone control and Android Connect to computer offer **Switch
account** with confirmation. It closes active phone access, removes that device's
saved pairing, uses Tailscale's native Logout API, and restarts the node to request
a fresh hosted sign-in link. School credentials, tasks, and the host-protected
storage key are not reset. A failed sign-out is reported and can be retried; it
does not restore the old pairing. After signing in to the same network, forget
the old pairing on the other device and approve a fresh USB pairing code.

- Native sign-in opens only official HTTPS `login.tailscale.com` links.
- Tailscale coordination/relays are hosted third-party services, not serverless
  networking. Their account terms, access controls, limits and reachability apply.
- Pairing uses authorized USB ADB forwarding to phone loopback port 37183.
  Loopback and the HTTP header exclude browsers, but do not authenticate other
  local native apps. A three-minute pairing window and explicit matching-code
  approval on the phone are mandatory.
- The Windows-generated 256-bit secret is transferred by USB and stored using
  Electron safeStorage / Android Keystore-backed AES-GCM state storage.
- Only the approved Tailscale IPv4 peer plus matching secret is forwarded to
  phone loopback ADB port 5555. There is no arbitrary-host forwarding API.
- Windows exposes only a loopback ADB endpoint. Tailnet port 4444 exists only on
  the phone. Tailscale ACLs still need to allow that connection.
- Android must explicitly enable the foreground service. It has a notification
  Stop action, a visible approval prompt and a Forget action. No boot start or
  silent re-pairing is implemented. Stop closes streams and listeners; Forget
  also removes the approved pair. Closing the scrcpy window alone is not revoke.
- USB setup still activates Android's normal network ADB listener. Turn off USB
  debugging when done, never expose it through a router, and approve only trusted
  computers. The app-specific secret does not replace Android's ADB authorization.

## Required Device Acceptance Checks

Build/unit tests cannot establish compatibility with a particular phone or Wi-Fi.
Before publishing, test on a real Android device and Windows laptop:

1. Direct Wi-Fi succeeds without sign-in, and old offline transports recover.
2. An isolated Wi-Fi triggers fallback, both devices sign in to the same personal
   account, mismatched codes are rejected, and USB approval completes.
3. Unplug USB only after the mirror opens; verify touch, keyboard, screen-off,
   audio (Android 11+ and capture-permitting apps), and reconnect after app restart.
4. Stop/Forget on Android cuts an active mirror, rejects the old computer, and
   does not affect another user's phone. An unrelated tailnet peer is refused.
5. Test phone reboot, battery restrictions, loss of network, unreachable relay,
   sign-in expiry, cancellation, interrupted pairing and replacement phones.

This has no guarantee of bypassing a network that blocks Tailscale itself. Relay
paths add latency and can reduce mirror quality. Android manufacturer restrictions
may require background battery permission. No user's account is signed in by tests.
