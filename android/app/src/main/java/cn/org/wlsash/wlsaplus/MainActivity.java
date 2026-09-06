package cn.org.wlsash.wlsaplus;

import android.os.Bundle;
import android.content.Intent;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WlsaToolsPlugin.class);
        super.onCreate(savedInstanceState);
        openPhoneReceiver(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); openPhoneReceiver(intent);
    }

    private void openPhoneReceiver(Intent intent) {
        if (intent != null && intent.getBooleanExtra("wlsaPhoneReceiver", false)) {
            intent.removeExtra("wlsaPhoneReceiver");
            startActivity(new Intent(this, PhoneReceiverActivity.class));
        }
    }
}
