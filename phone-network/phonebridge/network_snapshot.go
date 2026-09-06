package phonebridge

import (
	"encoding/json"
	"errors"
	"net"
	"net/netip"

	"tailscale.com/net/netmon"
)

type networkInterface struct {
	Name         string   `json:"name"`
	Index        int      `json:"index"`
	MTU          int      `json:"mtu"`
	Up           bool     `json:"up"`
	Loopback     bool     `json:"loopback"`
	PointToPoint bool     `json:"pointToPoint"`
	Multicast    bool     `json:"multicast"`
	Addresses    []string `json:"addresses"`
}

type networkSnapshot struct {
	Interfaces       []networkInterface `json:"interfaces"`
	DefaultInterface string             `json:"defaultInterface"`
	Gateway          string             `json:"gateway"`
}

func parseNetworkSnapshot(raw string) (*networkSnapshot, error) {
	if len(raw) > 1024*1024 {
		return nil, errors.New("Android network snapshot is too large")
	}
	var snapshot networkSnapshot
	if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
		return nil, err
	}
	if snapshot.Interfaces == nil {
		return nil, errors.New("Android network interfaces are missing")
	}
	if snapshot.Gateway != "" {
		if _, err := netip.ParseAddr(snapshot.Gateway); err != nil {
			return nil, errors.New("invalid Android network gateway")
		}
	}
	for _, iface := range snapshot.Interfaces {
		if iface.Name == "" || iface.Index < 0 || iface.MTU < 0 {
			return nil, errors.New("invalid Android network interface")
		}
		for _, address := range iface.Addresses {
			if _, err := netip.ParsePrefix(address); err != nil {
				return nil, errors.New("invalid Android network address")
			}
		}
	}
	return &snapshot, nil
}

func (snapshot *networkSnapshot) interfaceList() []netmon.Interface {
	result := make([]netmon.Interface, 0, len(snapshot.Interfaces))
	for _, iface := range snapshot.Interfaces {
		flags := net.Flags(0)
		if iface.Up {
			flags |= net.FlagUp | net.FlagRunning
		}
		if iface.Loopback {
			flags |= net.FlagLoopback
		}
		if iface.PointToPoint {
			flags |= net.FlagPointToPoint
		}
		if iface.Multicast {
			flags |= net.FlagMulticast
		}
		// Even an address-less interface must have non-nil AltAddrs, otherwise
		// Tailscale falls back to Go's Android-blocked netlink address lookup.
		addresses := make([]net.Addr, 0, len(iface.Addresses))
		for _, raw := range iface.Addresses {
			prefix := netip.MustParsePrefix(raw)
			addresses = append(addresses, &net.IPNet{IP: net.IP(prefix.Addr().AsSlice()), Mask: net.CIDRMask(prefix.Bits(), prefix.Addr().BitLen())})
		}
		result = append(result, netmon.Interface{Interface: &net.Interface{Name: iface.Name, Index: iface.Index, MTU: iface.MTU, Flags: flags}, AltAddrs: addresses})
	}
	return result
}

// UpdateNetwork provides Android's framework network snapshot before Start and
// notifies Tailscale when it changes. It does not change Windows network discovery.
func (b *Bridge) UpdateNetwork(raw string) error {
	snapshot, err := parseNetworkSnapshot(raw)
	if err != nil {
		return err
	}
	b.lifecycle.Lock()
	defer b.lifecycle.Unlock()
	updatePlatformNetwork(snapshot)
	if b.s != nil {
		if monitor, ok := b.s.Sys().NetMon.GetOK(); ok {
			monitor.InjectEvent()
		}
	}
	return nil
}
