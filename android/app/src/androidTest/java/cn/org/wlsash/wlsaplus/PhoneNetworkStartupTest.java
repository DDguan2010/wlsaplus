package cn.org.wlsash.wlsaplus;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.SystemClock;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import java.security.SecureRandom;
import java.util.Locale;
import java.util.UUID;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import phonebridge.Bridge;
import phonebridge.Phonebridge;

@RunWith(AndroidJUnit4.class)
public class PhoneNetworkStartupTest {
    @Test public void opensUsbPairingWithoutSignIn() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        File state = new File(context.getCacheDir(), "phone-network-startup-test-" + UUID.randomUUID());
        assertTrue(state.mkdir());
        byte[] key = new byte[32]; new SecureRandom().nextBytes(key);
        StringBuilder hex = new StringBuilder();
        for (byte value : key) hex.append(String.format(Locale.ROOT, "%02x", value & 255));
        Bridge bridge = Phonebridge.newBridge();
        try {
            bridge.start(new JSONObject().put("role", "phone").put("dir", state.getAbsolutePath())
                .put("storageKey", hex.toString()).put("hostname", "wlsaplus-startup-check").toString());
            JSONObject status = new JSONObject(bridge.status());
            assertTrue("ready".equals(status.optString("state")));
            assertTrue(status.optInt("protocol") == 2);
            assertTrue(status.optBoolean("pairing"));
            assertFalse(status.has("authUrl"));
            bridge.stop();
            assertTrue("stopped".equals(new JSONObject(bridge.status()).optString("state")));
        } finally {
            bridge.stop();
            deleteTestState(state);
        }
    }

    private static void deleteTestState(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTestState(child);
        file.delete();
    }
}
