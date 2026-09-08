package phonebridge

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestTLSAuthenticatesOnlyMatchingPairAndOppositeRole(t *testing.T) {
	for _, valid := range []bool{true, false} {
		t.Run(map[bool]string{true: "matched", false: "wrong-key"}[valid], func(t *testing.T) {
			a, b := net.Pipe()
			defer a.Close()
			defer b.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			p := testPair()
			wrong := p
			if !valid {
				wrong.Secret = strings.Repeat("34", 32)
			}
			server := make(chan error, 1)
			go func() {
				c, err := secureConnection(ctx, b, wrong, "phone")
				if err == nil {
					defer c.Close()
					payload := make([]byte, 4)
					_, err = io.ReadFull(c, payload)
					if err == nil {
						_, err = c.Write(payload)
					}
				}
				server <- err
			}()
			client, err := secureConnection(ctx, a, p, "desktop")
			if valid {
				if err != nil {
					t.Fatal(err)
				}
				defer client.Close()
				client.SetDeadline(time.Now().Add(time.Second))
				if _, err = client.Write([]byte("test")); err != nil {
					t.Fatal(err)
				}
				buf := make([]byte, 4)
				if _, err = io.ReadFull(client, buf); err != nil || string(buf) != "test" {
					t.Fatal("TLS round trip failed", err)
				}
			} else if err == nil {
				client.Close()
				t.Fatal("wrong pairing authenticated")
			}
			a.Close()
			b.Close()
			<-server
		})
	}
	p := testPair()
	desktop, _ := tlsConfig(p, "desktop")
	phone, _ := tlsConfig(p, "phone")
	cert, _ := x509.ParseCertificate(desktop.Certificates[0].Certificate[0])
	if err := desktop.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}); !errors.Is(err, errPeerAuthentication) {
		t.Fatal("same-role certificate did not report an authentication error", err)
	}
	if err := phone.VerifyConnection(tls.ConnectionState{PeerCertificates: []*x509.Certificate{cert}}); err != nil {
		t.Fatal("approved opposite-role certificate rejected", err)
	}
	if bytes.Equal(desktop.Certificates[0].Certificate[0], phone.Certificates[0].Certificate[0]) {
		t.Fatal("roles share a certificate")
	}
	room, token := relayCredentials(p)
	if len(room) != 64 || len(token) != 64 || room == token || token == p.Secret {
		t.Fatal("relay credential exposes pairing key")
	}
}

func TestInterruptedHandshakeKeepsSavedPairing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		c.Write(r.Context(), websocket.MessageText, []byte(`{"type":"ready","protocol":2}`))
		c.Close(websocket.StatusGoingAway, "network changed")
	}))
	defer server.Close()
	b := NewBridge()
	b.relayURL = server.URL
	b.ctx, b.cancel = context.WithCancel(context.Background())
	b.relayCtx = b.ctx
	b.role = "desktop"
	t.Cleanup(b.Stop)
	err := b.runRelay(b.ctx, testPair())
	if err == nil || !strings.Contains(err.Error(), "handshake interrupted") || strings.Contains(err.Error(), "again by USB") {
		t.Fatal("network interruption was confused with a lost pairing", err)
	}
}

func TestCloudflareRelayIntegration(t *testing.T) {
	relay := os.Getenv("WLSA_TEST_RELAY_URL")
	if relay == "" {
		t.Skip("set WLSA_TEST_RELAY_URL to a local or deployed test relay")
	}
	adb, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer adb.Close()
	go func() {
		for {
			c, err := adb.Accept()
			if err != nil {
				return
			}
			go func() { defer c.Close(); io.Copy(c, c) }()
		}
	}()
	configs := make(map[*Bridge]string)
	makeBridge := func(role string) *Bridge {
		b := NewBridge()
		b.relayURL = relay
		b.pairAddress = "127.0.0.1:0"
		b.adbAddress = adb.Addr().String()
		raw, _ := json.Marshal(config{Role: role, Dir: t.TempDir(), StorageKey: strings.Repeat("ab", 32), Hostname: "integration-test"})
		configs[b] = string(raw)
		if err := b.Start(string(raw)); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(b.Stop)
		return b
	}
	phone := makeBridge("phone")
	desktop := makeBridge("desktop")
	secret := make([]byte, 32)
	rand.Read(secret)
	p := pairing{Protocol: 2, Name: "Temporary test device", Secret: hex.EncodeToString(secret)}
	if postPair(phone, p, "").Code != 200 {
		t.Fatal("pair request failed")
	}
	if err := phone.ApprovePair(code(p.Secret)); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(p)
	if err := desktop.Connect(string(raw)); err != nil {
		t.Fatal(err)
	}
	desktop.mu.Lock()
	address := desktop.status.Endpoint
	desktop.mu.Unlock()
	conn, err := net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(15 * time.Second))
	payload := make([]byte, 256*1024)
	rand.Read(payload)
	written := make(chan error, 1)
	go func() { _, err := conn.Write(payload); written <- err }()
	received := make([]byte, len(payload))
	if _, err = io.ReadFull(conn, received); err != nil {
		t.Fatal(err)
	}
	if err = <-written; err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(payload, received) {
		t.Fatal("encrypted relay changed stream bytes")
	}
	if strings.Contains(phone.Status(), p.Secret) || strings.Contains(desktop.Status(), p.Secret) {
		t.Fatal("status exposes secret")
	}
	for change := 0; change < 3; change++ {
		phone.NetworkChanged()
		if change%2 == 0 {
			desktop.NetworkChanged()
		}
		conn.SetDeadline(time.Now().Add(5 * time.Second))
		if _, err := conn.Read(make([]byte, 1)); err == nil {
			t.Fatal("old stream survived network loss")
		}
		conn.Close()
		if err := desktop.Connect(string(raw)); err != nil {
			t.Fatal("network change did not recover", err)
		}
		conn, err = net.DialTimeout("tcp", address, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		conn.SetDeadline(time.Now().Add(10 * time.Second))
		if _, err = conn.Write([]byte("reconnected")); err != nil {
			t.Fatal(err)
		}
		got := make([]byte, len("reconnected"))
		if _, err = io.ReadFull(conn, got); err != nil || string(got) != "reconnected" {
			t.Fatal("recovered stream failed", err)
		}
	}
	phone.Stop()
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	if _, err = conn.Read(make([]byte, 1)); err == nil {
		t.Fatal("phone stop left its stream open")
	}
	conn.Close()
	if err = phone.Start(configs[phone]); err != nil {
		t.Fatal("saved phone pairing did not restart", err)
	}
	if err = desktop.Connect(string(raw)); err != nil {
		t.Fatal("saved pairing did not reconnect", err)
	}
	conn, err = net.DialTimeout("tcp", address, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err = conn.Write([]byte("resumed")); err != nil {
		t.Fatal(err)
	}
	resumed := make([]byte, 7)
	if _, err = io.ReadFull(conn, resumed); err != nil || string(resumed) != "resumed" {
		t.Fatal("stream failed after saved pairing restart", err)
	}
	if err := phone.Forget(); err != nil {
		t.Fatal(err)
	}
	conn.SetDeadline(time.Now().Add(3 * time.Second))
	conn.Write([]byte("revoked"))
	buf := make([]byte, 7)
	if _, err = io.ReadFull(conn, buf); err == nil {
		t.Fatal("revoked connection still reaches phone")
	}
	phone.mu.Lock()
	stillTrusted := phone.trusted != nil
	phone.mu.Unlock()
	if stillTrusted {
		t.Fatal("forget kept the pair")
	}
}
