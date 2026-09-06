package phonebridge

import (
	"net"
	"testing"
)

func TestAndroidNetworkSnapshotSuppliesAllInterfaceAddresses(t *testing.T) {
	snapshot, err := parseNetworkSnapshot(`{"interfaces":[{"name":"wlan0","index":12,"mtu":1500,"up":true,"multicast":true,"addresses":["192.168.1.25/24","2001:db8::1234/64"]},{"name":"down0","index":15,"addresses":[]}],"defaultInterface":"wlan0","gateway":"192.168.1.1"}`)
	if err != nil {
		t.Fatal(err)
	}
	interfaces := snapshot.interfaceList()
	addresses, err := interfaces[0].Addrs()
	if err != nil {
		t.Fatal(err)
	}
	if len(addresses) != 2 || addresses[0].String() != "192.168.1.25/24" || addresses[1].String() != "2001:db8::1234/64" {
		t.Fatalf("lost host addresses: %v", addresses)
	}
	if !interfaces[0].IsUp() || interfaces[1].IsUp() {
		t.Fatal("incorrect interface state")
	}
	// A nonexistent interface must not attempt Go's OS lookup, even with no IPs.
	addresses, err = interfaces[1].Addrs()
	if err != nil || addresses == nil || len(addresses) != 0 {
		t.Fatalf("empty interface used OS lookup: %v", err)
	}
	interfaces[0].AltAddrs[0].(*net.IPNet).IP[0] = 1
	addresses, _ = snapshot.interfaceList()[0].Addrs()
	if addresses[0].String() != "192.168.1.25/24" {
		t.Fatal("snapshot mutated by caller")
	}
}

func TestAndroidNetworkSnapshotOfflineAndMalformed(t *testing.T) {
	snapshot, err := parseNetworkSnapshot(`{"interfaces":[],"defaultInterface":"","gateway":""}`)
	if err != nil || len(snapshot.interfaceList()) != 0 {
		t.Fatal("offline snapshot rejected", err)
	}
	for _, raw := range []string{`{}`, `{"interfaces":null}`, `{"interfaces":[{"name":"wlan0","addresses":["invalid"]}]}`, `{"interfaces":[],"gateway":"example.com"}`, `{"interfaces":[{"name":"","addresses":[]}]}`} {
		if _, err := parseNetworkSnapshot(raw); err == nil {
			t.Fatalf("invalid snapshot accepted: %s", raw)
		}
	}
}
