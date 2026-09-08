package cn.org.wlsash.wlsaplus;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.PowerManager;
import android.net.Uri;
import android.provider.Settings;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

public final class PhoneReceiverActivity extends Activity {
    private final Handler handler = new Handler();
    private TextView status, approval, batteryHint;
    private Button enable, pair, approve, reject, forget, stop;
    private String code = "";
    private LinearLayout layout;
    private final Runnable refresh = new Runnable() { public void run() { render(); handler.postDelayed(this, 1000); } };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state); setTitle("Connect to computer");
        ScrollView scroll = new ScrollView(this); layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (20 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding); scroll.addView(layout); setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            layout.setPadding(padding + insets.getSystemWindowInsetLeft(), padding + insets.getSystemWindowInsetTop(), padding + insets.getSystemWindowInsetRight(), padding + insets.getSystemWindowInsetBottom());
            return insets;
        });
        text("Connect to computer", 24);
        text("Keep USB connected during setup. Only approve a code that matches WLSAPlus on your computer. Both devices need internet access when using the secure relay.", 16);
        status = text("Stopped", 16);
        enable = button("Enable connection", () -> {
            if (PhoneReceiverService.current != null) return;
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1);
            }
            Intent intent = new Intent(this, PhoneReceiverService.class);
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent); else startService(intent);
            enable.setEnabled(false);
        });
        pair = button("Pair computer", () -> command("pair", ""));
        approval = text("", 22);
        approve = button("Approve matching code", () -> {
            final String shownCode = code;
            new AlertDialog.Builder(this).setTitle("Does " + shownCode + " match your computer?")
                .setMessage("This computer will be able to see and control your phone while the connection is enabled.")
                .setNegativeButton("Cancel", null).setPositiveButton("Approve", (dialog, which) -> command("approve", shownCode)).show();
        });
        reject = button("Reject", () -> command("reject", ""));
        forget = button("Forget computer", () -> new AlertDialog.Builder(this).setTitle("Forget this computer?")
            .setMessage("This stops its access immediately. USB approval will be required to connect again.")
            .setNegativeButton("Cancel", null).setPositiveButton("Forget", (dialog, which) -> command("forget", "")).show());
        stop = button("Stop connection", () -> startService(new Intent(this, PhoneReceiverService.class).setAction("stop")));
        batteryHint = text("", 14);
        button("Background settings", () -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        text("After the Windows phone window opens, you can unplug USB. Temporary network interruptions reconnect automatically. After restarting the phone, connect USB again to enable debugging. Stop connection keeps your pairing and disables recovery until you enable it again.", 14);
        button("Back", this::finish);
    }

    private void command(String action, String value) {
        PhoneReceiverService service = PhoneReceiverService.current;
        if (service != null) service.command(action, value);
    }
    private TextView text(String value, int size) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setPadding(0, 12, 0, 12); layout.addView(view); return view;
    }
    private Button button(String label, Runnable action) {
        Button view = new Button(this); view.setText(label); view.setAllCaps(false); view.setOnClickListener(v -> action.run()); layout.addView(view); return view;
    }
    private void render() {
        JSONObject value = PhoneReceiverService.snapshot(); String state = value.optString("state", "stopped");
        boolean running = PhoneReceiverService.current != null;
        code = value.optString("code");
        String peer = value.optString("peer");
        String message = state.equals("ready") ? (peer.isEmpty() ? "Ready to pair" : "Paired with " + peer) : state;
        if (state.equals("connecting")) message = "Waiting for your computer...";
        if (value.optBoolean("connected")) message += "\nConnected through Cloudflare";
        if (value.optBoolean("pairing") && code.isEmpty()) message = "Waiting for your computer. Keep USB connected.";
        if (value.optInt("active") > 0) message += "\nComputer connected";
        if (!PhoneReceiverService.lastError.isEmpty()) message += "\n" + PhoneReceiverService.lastError;
        if (!value.optString("error").isEmpty()) message += "\n" + value.optString("error");
        if (!value.optString("connectionError").isEmpty()) message += "\n" + value.optString("connectionError");
        status.setText(message); enable.setEnabled(!running);
        enable.setVisibility(running ? View.GONE : View.VISIBLE); stop.setVisibility(running ? View.VISIBLE : View.GONE);
        pair.setVisibility(state.equals("ready") && peer.isEmpty() && code.isEmpty() && !value.optBoolean("pairing") ? View.VISIBLE : View.GONE);
        approval.setText(code.isEmpty() ? "" : value.optString("pending") + "\n" + code);
        approve.setVisibility(code.isEmpty() ? View.GONE : View.VISIBLE); reject.setVisibility(code.isEmpty() ? View.GONE : View.VISIBLE);
        forget.setVisibility(peer.isEmpty() ? View.GONE : View.VISIBLE);
        boolean unrestricted = getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName());
        batteryHint.setText(unrestricted
            ? "Keep this app running while controlling your phone. Force-stopping it prevents automatic recovery."
            : "To keep the connection active with the screen off, open Background settings and allow unrestricted battery use. On phones with an autostart setting, enable it for this app too. Android may still stop a restricted app.");
    }
    @Override public void onResume() { super.onResume(); handler.post(refresh); }
    @Override public void onPause() { handler.removeCallbacks(refresh); super.onPause(); }
}
