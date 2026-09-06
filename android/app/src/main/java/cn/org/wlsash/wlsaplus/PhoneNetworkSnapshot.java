package cn.org.wlsash.wlsaplus;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.RouteInfo;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

final class PhoneNetworkSnapshot {
    static String capture(Context context) throws Exception {
        JSONArray interfaces = new JSONArray();
        // The Android framework supports this lookup; Go's net.Interfaces uses
        // raw netlink, which is denied to normal Android 11+ applications.
        Enumeration<NetworkInterface> enumeration = NetworkInterface.getNetworkInterfaces();
        List<NetworkInterface> devices = enumeration == null ? Collections.emptyList() : Collections.list(enumeration);
        devices.sort((a, b) -> a.getName().compareTo(b.getName()));
        for (NetworkInterface device : devices) {
            try {
                JSONArray addresses = new JSONArray();
                for (InterfaceAddress address : device.getInterfaceAddresses()) {
                    if (address.getAddress() == null) continue;
                    String ip = InetAddress.getByAddress(address.getAddress().getAddress()).getHostAddress();
                    addresses.put(ip + "/" + address.getNetworkPrefixLength());
                }
                interfaces.put(new JSONObject().put("name", device.getName()).put("index", Math.max(0, device.getIndex()))
                    .put("mtu", Math.max(0, device.getMTU())).put("up", device.isUp()).put("loopback", device.isLoopback())
                    .put("pointToPoint", device.isPointToPoint()).put("multicast", device.supportsMulticast()).put("addresses", addresses));
            } catch (SocketException disappeared) {
                // An interface can disappear while Android switches networks.
            }
        }
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        Network active = manager.getActiveNetwork();
        LinkProperties link = active == null ? null : manager.getLinkProperties(active);
        String gateway = "";
        if (link != null) {
            for (RouteInfo route : link.getRoutes()) {
                if (!route.isDefaultRoute() || route.getGateway() == null || route.getGateway().isAnyLocalAddress()) continue;
                InetAddress address = route.getGateway();
                if (gateway.isEmpty() || address instanceof Inet4Address) gateway = InetAddress.getByAddress(address.getAddress()).getHostAddress();
                if (address instanceof Inet4Address) break;
            }
        }
        return new JSONObject().put("interfaces", interfaces)
            .put("defaultInterface", link == null || link.getInterfaceName() == null ? "" : link.getInterfaceName())
            .put("gateway", gateway).toString();
    }
}
