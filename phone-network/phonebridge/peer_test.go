package phonebridge

import (
	"context"
	"encoding/hex"
	"io"
	"net"
	"net/netip"
	"strings"
	"testing"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/tsdial"
	"tailscale.com/types/key"
)

func TestPeerMustBeVisibleBeforeDial(t *testing.T) {
	ip := netip.MustParseAddr("100.64.0.2")
	st := &ipnstate.Status{BackendState: "Running", CurrentTailnet: &ipnstate.TailnetStatus{Name: "test-tailnet"}}
	if err := peerVisible(st, ip); err == nil || !strings.Contains(err.Error(), "test-tailnet") {
		t.Fatalf("missing peer not reported: %v", err)
	}
	st.Peer = map[key.NodePublic]*ipnstate.PeerStatus{{}: {TailscaleIPs: []netip.Addr{ip}}}
	if err := peerVisible(st, ip); err != nil {
		t.Fatal(err)
	}
	st.BackendState = "NeedsLogin"
	if peerVisible(st, ip) == nil || peerVisible(nil, ip) == nil {
		t.Fatal("allowed a disconnected Tailscale node")
	}
}

func TestOverlayDialNeverFallsBackToSystemNetworking(t *testing.T) {
	ip := netip.MustParseAddr("100.64.0.2")
	called := false
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	dialer := &tsdial.Dialer{
		// This reproduces the unknown-peer route in tsnet.Dial.
		UseNetstackForIP: func(netip.Addr) bool { t.Fatal("used route-dependent UserDial"); return false },
		NetstackDialTCP: func(ctx context.Context, dst netip.AddrPort) (net.Conn, error) {
			called = true
			if dst != netip.AddrPortFrom(ip, 4444) {
				t.Fatalf("unexpected tunnel destination: %v", dst)
			}
			return a, nil
		},
	}
	got, err := dialOverlay(context.Background(), dialer, ip)
	if err != nil || got != a || !called {
		t.Fatalf("did not use embedded network: %v", err)
	}
	called = false
	if _, err := dialOverlay(context.Background(), dialer, netip.MustParseAddr("127.0.0.1")); err == nil || called {
		t.Fatal("accepted an address outside the phone network")
	}
	if _, err := dialOverlay(context.Background(), nil, ip); err == nil {
		t.Fatal("accepted an uninitialized network")
	}
}

func TestPhoneHandshakeReportsPreciseFailure(t *testing.T) {
	for _, tc := range []struct {
		name string
		ack  byte
		want string
	}{
		{"approved", 1, ""},
		{"debugging disabled", 2, "Android debugging is off"},
		{"pairing rejected", 0, "rejected the saved pairing"},
		{"invalid response", 9, "rejected the saved pairing"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, b := net.Pipe()
			defer a.Close()
			defer b.Close()
			a.SetDeadline(time.Now().Add(time.Second))
			b.SetDeadline(time.Now().Add(time.Second))
			done := make(chan error, 1)
			secret := strings.Repeat("ab", 32)
			go func() {
				var received [32]byte
				_, err := io.ReadFull(b, received[:])
				if err == nil && hex.EncodeToString(received[:]) != secret {
					t.Error("wrong authentication secret")
				}
				if err == nil {
					_, err = b.Write([]byte{tc.ack})
				}
				done <- err
			}()
			err := authenticatePeer(a, secret)
			if tc.want == "" && err != nil || tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)) {
				t.Fatalf("unexpected handshake error: %v", err)
			}
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPhoneHandshakeDoesNotHangOnSilentReceiver(t *testing.T) {
	a, b := net.Pipe()
	defer a.Close()
	defer b.Close()
	a.SetDeadline(time.Now().Add(20 * time.Millisecond))
	if err := authenticatePeer(a, strings.Repeat("ab", 32)); err == nil {
		t.Fatal("silent receiver accepted")
	}
}

func TestConnectionFailuresDoNotPoisonReadyState(t *testing.T) {
	b := NewBridge()
	b.status.State = "ready"
	b.connectionResult(context.Background(), io.EOF)
	if b.status.State != "ready" || b.status.Error != "" || b.status.ConnectionError == "" {
		t.Fatal("connection failure changed backend state")
	}
	b.connectionResult(context.Background(), nil)
	if b.status.ConnectionError != "" {
		t.Fatal("successful retry retained error")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	b.connectionResult(ctx, io.EOF)
	if b.status.ConnectionError != "" {
		t.Fatal("stopped session changed status")
	}
}
