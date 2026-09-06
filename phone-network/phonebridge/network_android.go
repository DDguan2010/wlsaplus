package phonebridge

import (
	"errors"
	"sync/atomic"

	"tailscale.com/net/netmon"
)

var androidNetwork atomic.Pointer[networkSnapshot]

func init() {
	// Register once, before tsnet starts. Changing the getter during operation
	// would race Tailscale's callers; only the immutable snapshot is replaced.
	netmon.RegisterInterfaceGetter(func() ([]netmon.Interface, error) {
		snapshot := androidNetwork.Load()
		if snapshot == nil {
			return nil, errors.New("Android network information has not been provided")
		}
		return snapshot.interfaceList(), nil
	})
}

func updatePlatformNetwork(snapshot *networkSnapshot) {
	androidNetwork.Store(snapshot)
	netmon.UpdateLastKnownDefaultRouteInterface(snapshot.DefaultInterface)
	netmon.UpdateLastKnownDefaultGateway(snapshot.Gateway)
}
