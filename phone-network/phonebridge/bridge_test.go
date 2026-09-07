package phonebridge

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func testBridge(t *testing.T) *Bridge {
	t.Helper()
	store, err := newStore(t.TempDir(), strings.Repeat("ab", 32))
	if err != nil {
		t.Fatal(err)
	}
	b := NewBridge()
	b.store = store
	b.role = "phone"
	b.relayURL = "https://127.0.0.1:1"
	b.status = status{State: "ready", Protocol: 2}
	b.ctx, b.cancel = context.WithCancel(context.Background())
	t.Cleanup(b.Stop)
	return b
}
func testPair() pairing {
	return pairing{Protocol: 2, Name: "My computer", Secret: strings.Repeat("12", 32)}
}
func postPair(b *Bridge, p pairing, origin string) *httptest.ResponseRecorder {
	data, _ := json.Marshal(p)
	r := httptest.NewRequest("POST", "/pair", strings.NewReader(string(data)))
	r.Header.Set("X-WLSA-USB", "1")
	if origin != "" {
		r.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	b.handlePairing(w, r)
	return w
}

func TestPairingRequiresWindowAndExplicitMatchingApproval(t *testing.T) {
	b := testBridge(t)
	p := testPair()
	if postPair(b, p, "").Code != 403 {
		t.Fatal("paired without user opening window")
	}
	if err := b.AllowPairing(); err != nil {
		t.Fatal(err)
	}
	if postPair(b, p, "https://example.com").Code != 403 {
		t.Fatal("browser request accepted")
	}
	response := postPair(b, p, "")
	if response.Code != 200 || b.trusted != nil {
		t.Fatal("approval was bypassed")
	}
	if err := b.ApprovePair("wrong"); err == nil {
		t.Fatal("approved mismatched code")
	}
	if err := b.ApprovePair(code(p.Secret)); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(postPair(b, p, "").Body.String(), `"accepted":true`) {
		t.Fatal("approval not acknowledged")
	}
	if strings.Contains(b.Status(), p.Secret) {
		t.Fatal("status exposes secret")
	}
	p.Secret = strings.Repeat("34", 32)
	if postPair(b, p, "").Code != 409 {
		t.Fatal("replaced trusted pair")
	}
	if err := b.Forget(); err != nil {
		t.Fatal(err)
	}
	if b.trusted != nil || postPair(b, p, "").Code != 403 {
		t.Fatal("forget did not revoke pairing")
	}
}

func TestExpiredRejectedAndInvalidPairing(t *testing.T) {
	b := testBridge(t)
	p := testPair()
	b.AllowPairing()
	postPair(b, p, "")
	b.pending.expires = time.Now().Add(-time.Second)
	if b.ApprovePair(code(p.Secret)) == nil {
		t.Fatal("expired approval accepted")
	}
	b.RejectPair()
	if b.pending != nil || postPair(b, p, "").Code != 403 {
		t.Fatal("rejected pairing remained open")
	}
	for _, secret := range []string{"", "short", strings.Repeat("ff", 31), strings.Repeat("FG", 32)} {
		p.Secret = secret
		if validatePair(p) == nil {
			t.Errorf("accepted %s", secret)
		}
	}
	for _, url := range []string{"https://user:password@example.com", "https://example.com/path", "http://example.com", "javascript:alert(1)"} {
		if validRelayURL(url) {
			t.Errorf("accepted %s", url)
		}
	}
	if !validRelayURL("https://phonewlsaplus.02studio.xyz") {
		t.Fatal("valid URL rejected")
	}
}

func TestForgetClosesPendingConnections(t *testing.T) {
	b := testBridge(t)
	a, c := net.Pipe()
	defer c.Close()
	if !b.track(b.ctx, a) {
		t.Fatal("track failed")
	}
	if err := b.Forget(); err != nil {
		t.Fatal(err)
	}
	c.SetReadDeadline(time.Now().Add(time.Second))
	var data [1]byte
	if _, err := c.Read(data[:]); err != io.EOF {
		t.Fatalf("pending connection survived revoke: %v", err)
	}
	b.untrack(a)
	b.cancel()
	a, c = net.Pipe()
	defer c.Close()
	if b.track(b.ctx, a) {
		t.Fatal("cancelled session accepted connection")
	}
}

func TestConnectionLimit(t *testing.T) {
	b := testBridge(t)
	for range 64 {
		a, c := net.Pipe()
		defer c.Close()
		defer a.Close()
		if !b.track(b.ctx, a) {
			t.Fatal("early limit")
		}
	}
	a, c := net.Pipe()
	defer c.Close()
	if b.track(b.ctx, a) {
		t.Fatal("unbounded connections")
	}
}

func TestEncryptedStorageRejectsTamperingAndWrongKey(t *testing.T) {
	b := testBridge(t)
	secret := []byte("private-pairing-identity")
	if err := b.store.WriteState("test", secret); err != nil {
		t.Fatal(err)
	}
	if err := b.store.WriteState("test", secret); err != nil {
		t.Fatal("cannot replace state", err)
	}
	file := b.store.filename("test")
	bytes, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(bytes), string(secret)) {
		t.Fatal("plaintext state")
	}
	value, err := b.store.ReadState("test")
	if err != nil || string(value) != string(secret) {
		t.Fatal("round trip failed", err)
	}
	wrong, _ := newStore(b.store.dir, strings.Repeat("ff", 32))
	if _, err := wrong.ReadState("test"); err == nil {
		t.Fatal("wrong key accepted")
	}
	bytes[len(bytes)-1] ^= 1
	os.WriteFile(file, bytes, 0600)
	if _, err := b.store.ReadState("test"); err == nil {
		t.Fatal("tampering undetected")
	}
	if err := b.store.WriteState("test", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := b.store.ReadState("test"); err != errStateNotExist {
		t.Fatal("delete failed", err)
	}
}

func TestPairingRequiresInitializedConnection(t *testing.T) {
	b := NewBridge()
	if err := b.AllowPairing(); err == nil || !strings.Contains(err.Error(), "enable") {
		t.Fatalf("expected enable-connection error: %v", err)
	}
	if b.status.State != "stopped" {
		t.Fatal("uninitialized pairing changed state")
	}
}

func TestStopInterruptsConnectionWait(t *testing.T) {
	b := testBridge(t)
	b.role = "desktop"
	raw, _ := json.Marshal(testPair())
	connected := make(chan error, 1)
	go func() { connected <- b.Connect(string(raw)) }()
	deadline := time.Now().Add(time.Second)
	for {
		b.mu.Lock()
		waiting := b.relayCtx != nil
		b.mu.Unlock()
		if waiting {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("Connect did not start")
		}
		time.Sleep(time.Millisecond)
	}
	stopped := make(chan struct{})
	go func() { b.Stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("Stop waited for the connection timeout")
	}
	if err := <-connected; err == nil {
		t.Fatal("stopped connection succeeded")
	}
	if !strings.Contains(b.Status(), `"state":"stopped"`) {
		t.Fatal("Stop did not clear connection state")
	}
}
