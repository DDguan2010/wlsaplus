package cn.org.wlsash.wlsaplus;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WlsaTools")
public class WlsaToolsPlugin extends Plugin {
    @PluginMethod
    public void importVpn(PluginCall call) {
        String url = call.getString("url");
        String name = call.getString("name", "02VPN");
        if (url == null || !url.startsWith("https://vpn.02studio.xyz/")) {
            call.reject("The VPN subscription URL is not allowed.");
            return;
        }

        Uri uri = Uri.parse("clash://install-config").buildUpon()
            .appendQueryParameter("url", url)
            .appendQueryParameter("name", name)
            .build();
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        try {
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("Install a Clash-compatible VPN client to use 02VPN on Android.");
        }
    }
}
