// Package phonebridge embeds Tailscale for the Windows helper and Android binding.
package phonebridge

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sync"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/tsnet"
)

const PairPort = "37183"
const tunnelPort = "4444"

var overlay = netip.MustParsePrefix("100.64.0.0/10")

type config struct{ Role, Dir, StorageKey, Hostname string }
type pairing struct {
	PeerIP string `json:"peerIp"`
	Name   string `json:"name"`
	Secret string `json:"secret"`
}
type pendingPair struct {
	pairing
	expires time.Time
}
type status struct {
	State           string `json:"state"`
	IP              string `json:"ip,omitempty"`
	AuthURL         string `json:"authUrl,omitempty"`
	Endpoint        string `json:"endpoint,omitempty"`
	Peer            string `json:"peer,omitempty"`
	Code            string `json:"code,omitempty"`
	Pending         string `json:"pending,omitempty"`
	Error           string `json:"error,omitempty"`
	ConnectionError string `json:"connectionError,omitempty"`
	Tailnet         string `json:"tailnet,omitempty"`
	Active          int    `json:"active"`
	Pairing         bool   `json:"pairing"`
}

// Bridge exposes only strings and simple methods so gomobile can bind it.
type Bridge struct {
	lifecycle     sync.Mutex
	mu            sync.Mutex
	s             *tsnet.Server
	store         *secureStore
	ctx           context.Context
	cancel        context.CancelFunc
	role          string
	trusted       *pairing
	pending       *pendingPair
	pairingUntil  time.Time
	listeners     []net.Listener
	pairServer    *http.Server
	forward       net.Listener
	forwardCancel context.CancelFunc
	forwardPair   pairing
	listening     bool
	streams       map[net.Conn]bool
	active        map[net.Conn]bool
	status        status
	startConfig   string
}

func NewBridge() *Bridge {
	return &Bridge{status: status{State: "stopped"}, streams: make(map[net.Conn]bool), active: make(map[net.Conn]bool)}
}

func (b *Bridge) Start(raw string) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	return b.start(raw)
}

func (b *Bridge) start(raw string) error {
	if b.s != nil {
		return nil
	}
	var cfg config
	if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
		return err
	}
	if cfg.Role != "phone" && cfg.Role != "desktop" {
		return errors.New("invalid bridge role")
	}
	if cfg.Dir == "" || cfg.Hostname == "" {
		return errors.New("missing bridge configuration")
	}
	store, err := newStore(cfg.Dir, cfg.StorageKey)
	if err != nil {
		return err
	}
	if err := configureLogs(cfg.Dir); err != nil {
		return err
	}
	s := &tsnet.Server{Dir: cfg.Dir, Store: store, Hostname: cfg.Hostname, ControlURL: "https://controlplane.tailscale.com", UserLogf: func(string, ...any) {}, Logf: func(string, ...any) {}}
	if err := s.Start(); err != nil {
		s.Close()
		return err
	}
	b.mu.Lock()
	b.ctx, b.cancel = context.WithCancel(context.Background())
	b.s, b.store, b.role = s, store, cfg.Role
	b.startConfig = raw
	b.status = status{State: "connecting"}
	if bytes, err := store.ReadState(ipn.StateKey("wlsa-pair")); err == nil {
		var p pairing
		if json.Unmarshal(bytes, &p) != nil || validatePair(p) != nil {
			b.mu.Unlock()
			b.stop()
			return errors.New("saved pairing is damaged")
		}
		b.trusted = &p
		b.status.Peer = p.Name
	} else if !errors.Is(err, ipn.ErrStateNotExist) {
		b.mu.Unlock()
		b.stop()
		return errors.New("saved pairing could not be decrypted")
	}
	b.mu.Unlock()
	if cfg.Role == "phone" {
		ln, err := net.Listen("tcp4", "127.0.0.1:"+PairPort)
		if err != nil {
			b.stop()
			return fmt.Errorf("pairing port unavailable: %w", err)
		}
		b.mu.Lock()
		b.listeners = append(b.listeners, ln)
		b.mu.Unlock()
		server := &http.Server{Handler: http.HandlerFunc(b.handlePairing), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, MaxHeaderBytes: 4096}
		b.mu.Lock()
		b.pairServer = server
		b.mu.Unlock()
		go server.Serve(ln)
	}
	go b.monitor(s, b.ctx, cfg.Role)
	return nil
}

func (b *Bridge) monitor(s *tsnet.Server, ctx context.Context, role string) {
	lc, err := s.LocalClient()
	if err != nil {
		b.fail(ctx, err)
		return
	}
	go func() {
		if _, err := s.Up(ctx); err != nil {
			b.fail(ctx, err)
			return
		}
		if role == "phone" {
			ln, err := s.Listen("tcp", ":"+tunnelPort)
			if err != nil {
				b.fail(ctx, err)
				return
			}
			b.mu.Lock()
			if ctx.Err() != nil {
				b.mu.Unlock()
				ln.Close()
				return
			}
			b.listeners = append(b.listeners, ln)
			b.listening = true
			b.mu.Unlock()
			for {
				c, err := ln.Accept()
				if err != nil {
					return
				}
				if b.track(ctx, c) {
					go b.receive(ctx, c)
				}
			}
		}
	}()
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		query, cancel := context.WithTimeout(ctx, 3*time.Second)
		st, err := lc.Status(query)
		cancel()
		b.mu.Lock()
		if ctx.Err() != nil {
			b.mu.Unlock()
			return
		}
		if err == nil && b.status.Error == "" {
			b.status.Tailnet = ""
			if st.CurrentTailnet != nil {
				b.status.Tailnet = st.CurrentTailnet.Name
			}
			b.status.AuthURL = st.AuthURL
			b.status.State = "connecting"
			if st.BackendState == "NeedsLogin" {
				b.status.State = "needs-login"
			}
			if st.BackendState == "NeedsMachineAuth" {
				b.status.State = "needs-approval"
			}
			if st.BackendState == "Running" && (role == "desktop" || b.listening) {
				b.status.State = "ready"
			}
			b.status.IP = ""
			for _, ip := range st.TailscaleIPs {
				if ip.Is4() {
					b.status.IP = ip.String()
				}
			}
		}
		if b.pending != nil && time.Now().After(b.pending.expires) {
			b.pending = nil
		}
		b.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (b *Bridge) fail(ctx context.Context, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ctx.Err() == nil {
		b.status.State = "error"
		b.status.Error = err.Error()
	}
}

func code(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return fmt.Sprintf("%06d", (uint32(sum[0])<<16|uint32(sum[1])<<8|uint32(sum[2]))%1000000)
}
func validatePair(p pairing) error {
	ip, err := netip.ParseAddr(p.PeerIP)
	secret, e := hex.DecodeString(p.Secret)
	if err != nil || !overlay.Contains(ip) || e != nil || len(secret) != 32 || len(p.Name) == 0 || len(p.Name) > 80 {
		return errors.New("invalid pairing information")
	}
	return nil
}

func (b *Bridge) Status() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.status
	s.Active = len(b.active)
	s.Pairing = time.Now().Before(b.pairingUntil)
	if b.pending != nil && time.Now().Before(b.pending.expires) {
		s.Pending = b.pending.Name
		s.Code = code(b.pending.Secret)
	}
	bytes, _ := json.Marshal(s)
	return string(bytes)
}

func (b *Bridge) AllowPairing() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.s == nil || b.role != "phone" || b.status.State != "ready" {
		return errors.New("sign in and wait for the phone connection first")
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
	// USB forwarding reaches this loopback API. Visible approval authenticates pairing;
	// these headers only exclude browser requests, not other native local apps.
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
		if b.trusted.PeerIP == p.PeerIP && subtle.ConstantTimeCompare([]byte(b.trusted.Secret), []byte(p.Secret)) == 1 {
			json.NewEncoder(w).Encode(map[string]any{"accepted": true, "ip": b.status.IP})
			return
		}
		http.Error(w, "another computer is paired", 409)
		return
	}
	if time.Now().After(b.pairingUntil) {
		http.Error(w, "tap Pair computer on the phone", 403)
		return
	}
	if b.pending != nil && b.pending.Secret != p.Secret && time.Now().Before(b.pending.expires) {
		http.Error(w, "another pairing is pending", 409)
		return
	}
	b.pending = &pendingPair{pairing: p, expires: b.pairingUntil}
	json.NewEncoder(w).Encode(map[string]any{"accepted": false, "code": code(p.Secret)})
}

func (b *Bridge) ApprovePair(expectedCode string) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.pending == nil || time.Now().After(b.pending.expires) || code(b.pending.Secret) != expectedCode {
		return errors.New("pairing changed or expired; check the code again")
	}
	bytes, _ := json.Marshal(b.pending.pairing)
	if err := b.store.WriteState("wlsa-pair", bytes); err != nil {
		return err
	}
	p := b.pending.pairing
	b.trusted = &p
	b.status.Peer = p.Name
	b.pending = nil
	b.pairingUntil = time.Time{}
	return nil
}

func (b *Bridge) RejectPair() {
	b.mu.Lock()
	b.pending = nil
	b.pairingUntil = time.Time{}
	b.mu.Unlock()
}

func (b *Bridge) Connect(raw string) error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	var p pairing
	if json.Unmarshal([]byte(raw), &p) != nil || validatePair(p) != nil {
		return errors.New("invalid paired phone")
	}
	b.mu.Lock()
	if b.role != "desktop" || b.status.State != "ready" {
		b.mu.Unlock()
		return errors.New("sign in and wait for the secure connection")
	}
	s, ctx := b.s, b.ctx
	b.mu.Unlock()
	// Verify the complete route and approval before exposing an ADB endpoint.
	probe, err := openPeer(s, ctx, p)
	b.connectionResult(ctx, err)
	if err != nil {
		return err
	}
	probe.Close()
	b.mu.Lock()
	if b.forward != nil && b.forwardPair == p {
		b.mu.Unlock()
		return nil
	}
	if b.forward != nil {
		b.forwardCancel()
		b.forward.Close()
		for c := range b.streams {
			c.Close()
		}
	}
	b.mu.Unlock()
	ln, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		return err
	}
	b.mu.Lock()
	ctx, b.forwardCancel = context.WithCancel(ctx)
	b.forward = ln
	b.forwardPair = p
	b.status.Endpoint = ln.Addr().String()
	b.status.Peer = p.Name
	b.mu.Unlock()
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			if b.track(ctx, c) {
				go b.send(s, ctx, c, p)
			}
		}
	}()
	return nil
}

func (b *Bridge) send(s *tsnet.Server, ctx context.Context, c net.Conn, p pairing) {
	defer c.Close()
	defer b.untrack(c)
	peer, err := openPeer(s, ctx, p)
	b.connectionResult(ctx, err)
	if err != nil {
		return
	}
	defer peer.Close()
	if !b.track(ctx, peer) {
		return
	}
	defer b.untrack(peer)
	b.pipe(c, peer)
}

func (b *Bridge) receive(ctx context.Context, c net.Conn) {
	defer c.Close()
	defer b.untrack(c)
	b.mu.Lock()
	var p pairing
	if b.trusted != nil {
		p = *b.trusted
	}
	b.mu.Unlock()
	remote, _, err := net.SplitHostPort(c.RemoteAddr().String())
	if err != nil || remote != p.PeerIP {
		return
	}
	c.SetDeadline(time.Now().Add(5 * time.Second))
	var received [32]byte
	if _, err = io.ReadFull(c, received[:]); err != nil {
		return
	}
	expected, _ := hex.DecodeString(p.Secret)
	if subtle.ConstantTimeCompare(received[:], expected) != 1 {
		c.Write([]byte{0})
		return
	}
	adb, err := net.DialTimeout("tcp", "127.0.0.1:5555", 3*time.Second)
	if err != nil {
		c.Write([]byte{2})
		return
	}
	defer adb.Close()
	// Register the authorized stream under the same lock used for revocation.
	b.mu.Lock()
	valid := ctx.Err() == nil && b.trusted != nil && *b.trusted == p
	if valid {
		b.streams[adb] = true
	}
	b.mu.Unlock()
	if !valid {
		return
	}
	defer b.untrack(adb)
	if _, err = c.Write([]byte{1}); err != nil {
		return
	}
	c.SetDeadline(time.Time{})
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
func (b *Bridge) untrack(c net.Conn) { b.mu.Lock(); delete(b.streams, c); b.mu.Unlock() }

func (b *Bridge) pipe(a, c net.Conn) {
	b.mu.Lock()
	b.active[a] = true
	b.mu.Unlock()
	defer func() { b.mu.Lock(); delete(b.active, a); b.mu.Unlock() }()
	done := make(chan struct{})
	go func() { io.Copy(a, c); a.Close(); c.Close(); close(done) }()
	io.Copy(c, a)
	a.Close()
	c.Close()
	<-done
}

func (b *Bridge) Forget() error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	return b.forget()
}

func (b *Bridge) forget() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.store != nil {
		if err := b.store.WriteState("wlsa-pair", nil); err != nil {
			return err
		}
	}
	b.trusted = nil
	b.pending = nil
	b.status.Peer = ""
	b.pairingUntil = time.Time{}
	if b.forward != nil {
		b.forwardCancel()
		b.forward.Close()
		b.forward = nil
		b.status.Endpoint = ""
	}
	for c := range b.streams {
		c.Close()
	}
	return nil
}

// SwitchAccount revokes local pairing and signs out through Tailscale. Restarting
// the node also replaces its old listeners, pending login and status monitor.
func (b *Bridge) SwitchAccount() error {
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	if b.startConfig == "" {
		return errors.New("enable the phone connection before switching accounts")
	}
	if b.s == nil {
		if err := b.start(b.startConfig); err != nil {
			return err
		}
	}
	if err := b.forget(); err != nil {
		b.stop()
		return fmt.Errorf("could not remove the saved phone pairing: %w", err)
	}
	s := b.s
	b.mu.Lock()
	b.cancel()
	b.status = status{State: "switching-account"}
	b.mu.Unlock()
	lc, err := s.LocalClient()
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err = lc.Logout(ctx)
		cancel()
	}
	b.stop()
	if err != nil {
		return fmt.Errorf("Tailscale sign-out did not complete. Check the internet connection and try Switch account again: %w", err)
	}
	// tsnet starts a fresh interactive sign-in when the saved node is logged out.
	return b.start(b.startConfig)
}

func (b *Bridge) stop() {
	b.mu.Lock()
	s := b.s
	if s == nil {
		b.mu.Unlock()
		return
	}
	b.cancel()
	if b.pairServer != nil {
		b.pairServer.Close()
	}
	for _, ln := range b.listeners {
		ln.Close()
	}
	if b.forward != nil {
		b.forward.Close()
	}
	for c := range b.streams {
		c.Close()
	}
	b.mu.Unlock()
	s.Close()
	b.mu.Lock()
	b.s = nil
	b.listeners = nil
	b.pairServer = nil
	b.forward = nil
	b.listening = false
	b.trusted = nil
	b.pending = nil
	b.pairingUntil = time.Time{}
	b.status = status{State: "stopped"}
	b.mu.Unlock()
}

func (b *Bridge) Stop() { b.lifecycle.Lock(); defer b.lifecycle.Unlock(); b.stop() }

func ValidLoginURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host == "login.tailscale.com" && u.User == nil
}
