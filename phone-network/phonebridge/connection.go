// Package phonebridge provides the encrypted Cloudflare phone connection.
package phonebridge

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/hashicorp/yamux"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

const PairPort = "37183"
const protocolVersion = 2
const pairStateKey = "wlsa-relay-pair-v2"

var RelayURL = "https://phonewlsaplus.02studio.xyz"

type config struct{ Role, Dir, StorageKey, Hostname string }
type pairing struct {
	Protocol int    `json:"protocol"`
	Name     string `json:"name"`
	Secret   string `json:"secret"`
}
type pendingPair struct {
	pairing
	expires time.Time
}
type status struct {
	State           string `json:"state"`
	Protocol        int    `json:"protocol"`
	Relay           string `json:"relay"`
	Connected       bool   `json:"connected"`
	Endpoint        string `json:"endpoint,omitempty"`
	Peer            string `json:"peer,omitempty"`
	Code            string `json:"code,omitempty"`
	Pending         string `json:"pending,omitempty"`
	Error           string `json:"error,omitempty"`
	ConnectionError string `json:"connectionError,omitempty"`
	Active          int    `json:"active"`
	Pairing         bool   `json:"pairing"`
}

// Bridge exposes only simple methods for the Android gomobile binding.
type Bridge struct {
	lifecycle          sync.Mutex
	mu                 sync.Mutex
	store              *secureStore
	ctx                context.Context
	cancel             context.CancelFunc
	role               string
	trusted            *pairing
	pending            *pendingPair
	pairingUntil       time.Time
	pairServer         *http.Server
	forward            net.Listener
	forwardPair        pairing
	relayCtx           context.Context
	relayCancel        context.CancelFunc
	relayAttemptCancel context.CancelFunc
	relayWake          chan struct{}
	session            *yamux.Session
	streams            map[net.Conn]bool
	status             status
	relayURL           string
	pairAddress        string
	adbAddress         string
}

func NewBridge() *Bridge {
	return &Bridge{status: status{State: "stopped", Protocol: protocolVersion}, streams: make(map[net.Conn]bool), relayURL: RelayURL, pairAddress: "127.0.0.1:" + PairPort, adbAddress: "127.0.0.1:5555"}
}
func (b *Bridge) Start(raw string) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	running := b.cancel != nil
	b.mu.Unlock()
	if running {
		return nil
	}
	var cfg config
	if json.Unmarshal([]byte(raw), &cfg) != nil || (cfg.Role != "phone" && cfg.Role != "desktop") || cfg.Dir == "" {
		return errors.New("invalid phone connection configuration")
	}
	if !validRelayURL(b.relayURL) {
		return errors.New("the phone relay URL is not configured correctly")
	}
	store, err := newStore(cfg.Dir, cfg.StorageKey)
	if err != nil {
		return err
	}
	var saved *pairing
	if data, err := store.ReadState(pairStateKey); err == nil {
		var p pairing
		if json.Unmarshal(data, &p) != nil || validatePair(p) != nil {
			return errors.New("saved phone pairing is damaged")
		}
		saved = &p
	} else if !errors.Is(err, errStateNotExist) {
		return err
	}
	b.mu.Lock()
	b.ctx, b.cancel = context.WithCancel(context.Background())
	b.store = store
	b.role = cfg.Role
	b.trusted = saved
	b.status = status{State: "ready", Protocol: protocolVersion, Relay: b.relayURL}
	if saved != nil {
		b.status.Peer = saved.Name
	}
	b.mu.Unlock()
	if cfg.Role == "phone" {
		ln, err := net.Listen("tcp4", b.pairAddress)
		if err != nil {
			b.stop()
			return fmt.Errorf("USB pairing port unavailable: %w", err)
		}
		server := &http.Server{Handler: http.HandlerFunc(b.handlePairing), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 4096}
		b.mu.Lock()
		b.pairServer = server
		b.mu.Unlock()
		go server.Serve(ln)
		if saved != nil {
			b.beginRelay(*saved)
		} else {
			b.AllowPairing()
		}
	}
	return nil
}
func (b *Bridge) Status() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.status
	s.Active = len(b.streams) / 2
	s.Pairing = time.Now().Before(b.pairingUntil)
	if b.pending != nil && time.Now().Before(b.pending.expires) {
		s.Pending = b.pending.Name
		s.Code = code(b.pending.Secret)
	}
	data, _ := json.Marshal(s)
	return string(data)
}
func code(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return fmt.Sprintf("%06d", (uint32(sum[0])<<16|uint32(sum[1])<<8|uint32(sum[2]))%1000000)
}
func validatePair(p pairing) error {
	secret, err := hex.DecodeString(p.Secret)
	if p.Protocol != protocolVersion || err != nil || len(secret) != 32 || p.Secret != strings.ToLower(p.Secret) || len(strings.TrimSpace(p.Name)) == 0 || len(p.Name) > 80 {
		return errors.New("invalid phone pairing; update both apps and pair again by USB")
	}
	return nil
}
func (b *Bridge) AllowPairing() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.cancel == nil || b.role != "phone" {
		return errors.New("enable the phone connection first")
	}
	if b.trusted != nil {
		return errors.New("forget the current computer before pairing another")
	}
	b.pairingUntil = time.Now().Add(3 * time.Minute)
	return nil
}
func (b *Bridge) handlePairing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	// Local native programs still require the phone's visible matching-code approval.
	if r.Header.Get("Origin") != "" || r.Header.Get("X-WLSA-USB") != "1" {
		http.Error(w, "forbidden", 403)
		return
	}
	if r.Method == "GET" && r.URL.Path == "/status" {
		io.WriteString(w, b.Status())
		return
	}
	var p pairing
	if r.Method != "POST" || r.URL.Path != "/pair" || json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&p) != nil || validatePair(p) != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.trusted != nil {
		if subtle.ConstantTimeCompare([]byte(b.trusted.Secret), []byte(p.Secret)) == 1 {
			json.NewEncoder(w).Encode(map[string]any{"accepted": true, "protocol": protocolVersion})
			return
		}
		http.Error(w, "another computer is paired", 409)
		return
	}
	if time.Now().After(b.pairingUntil) {
		http.Error(w, "enable pairing on the phone", 403)
		return
	}
	if b.pending != nil && b.pending.Secret != p.Secret && time.Now().Before(b.pending.expires) {
		http.Error(w, "another pairing is pending", 409)
		return
	}
	b.pending = &pendingPair{pairing: p, expires: b.pairingUntil}
	json.NewEncoder(w).Encode(map[string]any{"accepted": false, "protocol": protocolVersion, "code": code(p.Secret)})
}
func (b *Bridge) ApprovePair(expectedCode string) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	if b.cancel == nil || b.pending == nil || time.Now().After(b.pending.expires) || code(b.pending.Secret) != expectedCode {
		b.mu.Unlock()
		return errors.New("pairing changed or expired; check the code again")
	}
	p := b.pending.pairing
	data, _ := json.Marshal(p)
	if err := b.store.WriteState(pairStateKey, data); err != nil {
		b.mu.Unlock()
		return err
	}
	b.trusted = &p
	b.status.Peer = p.Name
	b.pending = nil
	b.pairingUntil = time.Time{}
	b.mu.Unlock()
	b.beginRelay(p)
	return nil
}
func (b *Bridge) RejectPair() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.pending = nil
	b.pairingUntil = time.Time{}
}
func (b *Bridge) Connect(raw string) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	var p pairing
	if json.Unmarshal([]byte(raw), &p) != nil || validatePair(p) != nil {
		return errors.New("pair the phone again by USB")
	}
	b.mu.Lock()
	if b.role != "desktop" || b.cancel == nil {
		b.mu.Unlock()
		return errors.New("enable the phone connection first")
	}
	ctx := b.ctx
	same := b.relayCancel != nil && b.forwardPair == p
	b.mu.Unlock()
	if !same {
		b.closeRelay()
		b.beginRelay(p)
	}
	wait, done := context.WithTimeout(ctx, 45*time.Second)
	defer done()
	s, err := b.waitSession(wait)
	if err != nil {
		b.mu.Lock()
		detail := b.status.ConnectionError
		b.mu.Unlock()
		if detail != "" {
			return errors.New(detail)
		}
		return errors.New("the paired phone is not connected; enable Connect to computer on the phone and check the internet connection")
	}
	probe, err := s.OpenStream()
	if err != nil {
		return errors.New("phone connection interrupted; try again")
	}
	probe.SetReadDeadline(time.Now().Add(5 * time.Second))
	var ack [1]byte
	_, err = io.ReadFull(probe, ack[:])
	probe.Close()
	if err != nil {
		return errors.New("the phone did not respond; enable its connection and try again")
	}
	if ack[0] != 1 {
		return errors.New("Android debugging is off; reconnect USB and use Connect by USB again")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	b.mu.Lock()
	if b.forward != nil {
		b.mu.Unlock()
		return nil
	}
	b.mu.Unlock()
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	b.mu.Lock()
	b.forward = ln
	b.status.Endpoint = ln.Addr().String()
	ctx = b.relayCtx
	b.mu.Unlock()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			if b.track(ctx, c) {
				go b.send(ctx, c)
			}
		}
	}()
	return nil
}

// NetworkChanged discards a socket tied to a lost Android network, keeping the
// approved pair and local ADB listener. It also interrupts reconnect backoff.
func (b *Bridge) NetworkChanged() {
	b.mu.Lock()
	cancel, wake := b.relayAttemptCancel, b.relayWake
	if b.relayCancel != nil {
		b.session = nil
		b.status.Connected = false
		b.status.State = "connecting"
	}
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if wake != nil {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}

func (b *Bridge) waitSession(ctx context.Context) (*yamux.Session, error) {
	timer := time.NewTicker(100 * time.Millisecond)
	defer timer.Stop()
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		b.mu.Lock()
		s := b.session
		b.mu.Unlock()
		if s != nil && !s.IsClosed() {
			return s, nil
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}
func (b *Bridge) send(ctx context.Context, c net.Conn) {
	defer c.Close()
	defer b.untrack(c)
	wait, done := context.WithTimeout(ctx, 10*time.Second)
	s, err := b.waitSession(wait)
	done()
	if err != nil {
		return
	}
	peer, err := s.OpenStream()
	if err != nil {
		return
	}
	defer peer.Close()
	if !b.track(ctx, peer) {
		return
	}
	defer b.untrack(peer)
	peer.SetReadDeadline(time.Now().Add(5 * time.Second))
	var ack [1]byte
	if _, err = io.ReadFull(peer, ack[:]); err != nil {
		return
	}
	peer.SetReadDeadline(time.Time{})
	if ack[0] != 1 {
		b.mu.Lock()
		b.status.ConnectionError = "Android debugging is off. Reconnect USB."
		b.mu.Unlock()
		return
	}
	b.pipe(c, peer)
}
func (b *Bridge) receive(ctx context.Context, c net.Conn) {
	defer c.Close()
	defer b.untrack(c)
	adb, err := (&net.Dialer{Timeout: 3 * time.Second}).DialContext(ctx, "tcp", b.adbAddress)
	if err != nil {
		c.Write([]byte{2})
		return
	}
	defer adb.Close()
	if !b.track(ctx, adb) {
		return
	}
	defer b.untrack(adb)
	if _, err = c.Write([]byte{1}); err != nil {
		return
	}
	b.pipe(c, adb)
}
func (b *Bridge) track(ctx context.Context, c net.Conn) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ctx.Err() != nil || len(b.streams) >= 64 {
		c.Close()
		return false
	}
	b.streams[c] = true
	return true
}
func (b *Bridge) untrack(c net.Conn) { b.mu.Lock(); defer b.mu.Unlock(); delete(b.streams, c) }
func (b *Bridge) pipe(a, c net.Conn) {
	done := make(chan struct{})
	go func() { io.Copy(a, c); a.Close(); c.Close(); close(done) }()
	io.Copy(c, a)
	a.Close()
	c.Close()
	<-done
}
func (b *Bridge) closeRelay() {
	b.mu.Lock()
	cancel := b.relayCancel
	b.relayCancel = nil
	b.relayCtx = nil
	b.relayAttemptCancel = nil
	b.relayWake = nil
	s := b.session
	b.session = nil
	ln := b.forward
	b.forward = nil
	streams := make([]net.Conn, 0, len(b.streams))
	for c := range b.streams {
		streams = append(streams, c)
	}
	b.status.Connected = false
	b.status.Endpoint = ""
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if ln != nil {
		ln.Close()
	}
	if s != nil {
		s.Close()
	}
	for _, c := range streams {
		c.Close()
	}
}
func (b *Bridge) Forget() error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.mu.Lock()
	if b.store != nil {
		if err := b.store.WriteState(pairStateKey, nil); err != nil {
			b.mu.Unlock()
			return err
		}
	}
	b.trusted = nil
	b.pending = nil
	b.pairingUntil = time.Time{}
	b.status.Peer = ""
	b.status.ConnectionError = ""
	b.status.State = "ready"
	b.mu.Unlock()
	b.closeRelay()
	return nil
}
func (b *Bridge) stop() {
	b.mu.Lock()
	cancel := b.cancel
	b.cancel = nil
	server := b.pairServer
	b.pairServer = nil
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if server != nil {
		server.Close()
	}
	b.closeRelay()
	b.mu.Lock()
	b.pending = nil
	b.trusted = nil
	b.pairingUntil = time.Time{}
	b.status = status{State: "stopped", Protocol: protocolVersion}
	b.mu.Unlock()
}
func (b *Bridge) Stop() {
	// Interrupt Connect's network wait before acquiring its lifecycle lock.
	b.mu.Lock()
	cancel := b.cancel
	b.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	b.stop()
}
