package phonebridge

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/netip"
	"slices"
	"time"

	"tailscale.com/ipn/ipnstate"
	"tailscale.com/net/tsdial"
	"tailscale.com/tsnet"
)

func peerVisible(st *ipnstate.Status, ip netip.Addr) error {
	if st == nil || st.BackendState != "Running" {
		return errors.New("Tailscale is not connected on this computer. Sign in and wait for the secure connection")
	}
	for _, peer := range st.Peer {
		if peer != nil && slices.Contains(peer.TailscaleIPs, ip) {
			return nil
		}
	}
	tailnet := "this computer's Tailscale network"
	if st.CurrentTailnet != nil && st.CurrentTailnet.Name != "" {
		tailnet = fmt.Sprintf("Tailscale network %q", st.CurrentTailnet.Name)
	}
	return fmt.Errorf("the paired phone is not visible in %s. Use the same Tailscale network on both devices and check device approval and access rules at login.tailscale.com/admin/machines", tailnet)
}

func dialOverlay(ctx context.Context, dialer *tsdial.Dialer, ip netip.Addr) (net.Conn, error) {
	if !overlay.Contains(ip) || dialer == nil || dialer.NetstackDialTCP == nil {
		return nil, errors.New("the secure phone network is unavailable")
	}
	// tsnet.Dial falls back to the OS for unknown peers, which can send the
	// pairing secret into a system VPN. This connection must stay in netstack.
	return dialer.NetstackDialTCP(ctx, netip.AddrPortFrom(ip, 4444))
}

func openPeer(s *tsnet.Server, parent context.Context, p pairing) (net.Conn, error) {
	ctx, cancel := context.WithTimeout(parent, 20*time.Second)
	defer cancel()
	lc, err := s.LocalClient()
	if err != nil {
		return nil, err
	}
	ip := netip.MustParseAddr(p.PeerIP)
	// A newly approved device can take a few seconds to reach the peer map.
	visibilityDeadline := time.Now().Add(5 * time.Second)
	for {
		st, err := lc.Status(ctx)
		if err != nil {
			return nil, errors.New("could not read Tailscale connection status; restart the secure connection")
		}
		if err = peerVisible(st, ip); err == nil {
			break
		} else if time.Now().After(visibilityDeadline) {
			return nil, err
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
	dialer, ok := s.Sys().Dialer.GetOK()
	if !ok {
		return nil, errors.New("the secure phone network is unavailable")
	}
	peer, err := dialOverlay(ctx, dialer, ip)
	if err != nil {
		return nil, errors.New("the phone is visible in Tailscale but its connection service is unreachable. Enable Connect to computer on the phone. Check Tailscale access rules and whether this network allows its relay connections")
	}
	// Bound both dial and authentication, but do not time-limit a live stream.
	deadline, _ := ctx.Deadline()
	peer.SetDeadline(deadline)
	stopCancel := context.AfterFunc(ctx, func() { peer.Close() })
	err = authenticatePeer(peer, p.Secret)
	stopped := stopCancel()
	if err != nil || !stopped || ctx.Err() != nil {
		peer.Close()
		if err != nil {
			return nil, err
		}
		return nil, ctx.Err()
	}
	peer.SetDeadline(time.Time{})
	return peer, nil
}

func authenticatePeer(peer net.Conn, secret string) error {
	bytes, err := hex.DecodeString(secret)
	if err != nil || len(bytes) != 32 {
		return errors.New("invalid pairing information")
	}
	if _, err = peer.Write(bytes); err != nil {
		return errors.New("the secure phone connection closed during authentication; enable the phone connection and retry")
	}
	var ack [1]byte
	if _, err = io.ReadFull(peer, ack[:]); err != nil {
		return errors.New("the phone did not complete pairing authentication. Keep its connection enabled and check the saved pairing on both devices")
	}
	switch ack[0] {
	case 1:
		return nil
	case 2:
		return errors.New("the phone is reachable but Android debugging is off. Reconnect USB and click Connect by USB to enable it again")
	default:
		return errors.New("the phone rejected the saved pairing. Forget the computer on the phone and the phone on Windows, then pair again over USB")
	}
}

func (b *Bridge) connectionResult(ctx context.Context, err error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ctx.Err() != nil {
		return
	}
	b.status.ConnectionError = ""
	if err != nil {
		b.status.ConnectionError = err.Error()
	}
}
