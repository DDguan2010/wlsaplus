package phonebridge

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/coder/websocket"
	"github.com/hashicorp/yamux"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strings"
	"time"
)

func validRelayURL(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Host == "" {
		return false
	}
	return u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost"))
}
func relayCredentials(p pairing) (string, string) {
	secret, _ := hex.DecodeString(p.Secret)
	room := sha256.Sum256(append([]byte("wlsaplus-room-v2:"), secret...))
	token := deriveKey(secret, "relay-authorization")
	return hex.EncodeToString(room[:]), hex.EncodeToString(token)
}
func (b *Bridge) beginRelay(p pairing) {
	b.mu.Lock()
	ctx, cancel := context.WithCancel(b.ctx)
	b.relayCtx = ctx
	b.relayCancel = cancel
	wake := make(chan struct{}, 1)
	b.relayWake = wake
	b.forwardPair = p
	b.status.State = "connecting"
	b.status.Peer = p.Name
	b.mu.Unlock()
	go func() {
		backoff := time.Second
		for ctx.Err() == nil {
			started := time.Now()
			err := b.runRelay(ctx, p)
			b.mu.Lock()
			if b.relayCtx == ctx {
				b.session = nil
				b.status.Connected = false
				b.status.State = "connecting"
				if err != nil {
					b.status.ConnectionError = err.Error()
				}
			}
			b.mu.Unlock()
			if ctx.Err() != nil {
				return
			}
			if time.Since(started) > 30*time.Second {
				backoff = time.Second
			}
			timer := time.NewTimer(backoff + time.Duration(rand.IntN(500))*time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return
			case <-timer.C:
			case <-wake:
				timer.Stop()
				backoff = time.Second
			}
			if backoff < 8*time.Second {
				backoff *= 2
			}
		}
	}()
}
func (b *Bridge) runRelay(ctx context.Context, p pairing) error {
	connectionCtx, end := context.WithCancel(ctx)
	defer end()
	b.mu.Lock()
	if b.relayCtx != ctx || ctx.Err() != nil {
		b.mu.Unlock()
		return context.Canceled
	}
	b.relayAttemptCancel = end
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		if b.relayCtx == ctx {
			b.relayAttemptCancel = nil
		}
		b.mu.Unlock()
	}()
	room, token := relayCredentials(p)
	b.mu.Lock()
	role := b.role
	b.mu.Unlock()
	u := strings.Replace(b.relayURL, "https://", "wss://", 1)
	u = strings.Replace(u, "http://", "ws://", 1) + "/v2/rooms/" + room + "/" + role
	// Redirects must never forward the relay bearer credential to another host.
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	dial, done := context.WithTimeout(connectionCtx, 12*time.Second)
	c, response, err := websocket.Dial(dial, u, &websocket.DialOptions{HTTPClient: client, HTTPHeader: http.Header{"Authorization": []string{"Bearer " + token}, "X-WLSA-Protocol": []string{"2"}}, CompressionMode: websocket.CompressionDisabled})
	done()
	if err != nil {
		if response != nil {
			switch response.StatusCode {
			case 404:
				return errors.New("the Cloudflare phone relay is not deployed yet; contact the app maintainer")
			case 429:
				return errors.New("the phone relay is busy; retrying shortly")
			case 401, 403:
				return errors.New("the relay rejected this connection; update both apps and pair again by USB")
			}
		}
		return errors.New("could not reach the Cloudflare phone relay; check the internet connection")
	}
	defer c.CloseNow()
	c.SetReadLimit(65536)
	stop := context.AfterFunc(connectionCtx, func() { c.CloseNow() })
	defer stop()
	// Detect broken sockets even while waiting for the paired device to come online.
	go func() {
		timer := time.NewTicker(25 * time.Second)
		defer timer.Stop()
		for {
			select {
			case <-connectionCtx.Done():
				return
			case <-timer.C:
				ping, cancel := context.WithTimeout(connectionCtx, 8*time.Second)
				err := c.Ping(ping)
				cancel()
				if err != nil {
					c.CloseNow()
					return
				}
			}
		}
	}()
	b.mu.Lock()
	if b.relayCtx == ctx {
		b.status.ConnectionError = ""
	}
	b.mu.Unlock()
	kind, message, err := c.Read(connectionCtx)
	if err != nil {
		return errors.New("Cloudflare connection interrupted; reconnecting")
	}
	var ready struct {
		Type     string `json:"type"`
		Protocol int    `json:"protocol"`
	}
	if kind != websocket.MessageText || len(message) > 256 || json.Unmarshal(message, &ready) != nil || ready.Type != "ready" || ready.Protocol != protocolVersion {
		return errors.New("the phone relay uses an incompatible protocol")
	}
	raw := websocket.NetConn(connectionCtx, c, websocket.MessageBinary)
	secure, err := secureConnection(connectionCtx, raw, p, role)
	if err != nil {
		if errors.Is(err, errPeerAuthentication) {
			return errors.New("the paired device key does not match; approve this computer again by USB")
		}
		return errors.New("secure phone handshake interrupted; reconnecting with the saved pairing")
	}
	defer secure.Close()
	cfg := yamux.DefaultConfig()
	cfg.LogOutput = io.Discard
	cfg.KeepAliveInterval = 15 * time.Second
	cfg.ConnectionWriteTimeout = 8 * time.Second
	cfg.StreamOpenTimeout = 8 * time.Second
	cfg.StreamCloseTimeout = 5 * time.Second
	var session *yamux.Session
	if role == "phone" {
		session, err = yamux.Server(secure, cfg)
	} else {
		session, err = yamux.Client(secure, cfg)
	}
	if err != nil {
		return fmt.Errorf("cannot start the encrypted phone connection: %w", err)
	}
	defer session.Close()
	b.mu.Lock()
	if b.relayCtx != ctx || connectionCtx.Err() != nil {
		b.mu.Unlock()
		return context.Canceled
	}
	b.session = session
	b.status.State = "ready"
	b.status.Connected = true
	b.status.ConnectionError = ""
	b.mu.Unlock()
	if role == "phone" {
		for {
			stream, err := session.AcceptStream()
			if err != nil {
				return errors.New("computer disconnected; waiting to reconnect")
			}
			if b.track(ctx, stream) {
				go b.receive(ctx, stream)
			}
		}
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-session.CloseChan():
		return errors.New("phone disconnected; enable its connection to reconnect")
	}
}
