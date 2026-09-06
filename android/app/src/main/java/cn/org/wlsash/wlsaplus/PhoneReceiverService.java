package cn.org.wlsash.wlsaplus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import phonebridge.Bridge;
import phonebridge.Phonebridge;

public final class PhoneReceiverService extends Service {
    static volatile PhoneReceiverService current;
    static volatile String lastError = "";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Bridge bridge;
    private String networkSnapshot = "";
    private volatile String status = "{\"state\":\"connecting\"}";
    private volatile boolean stopping;
    private volatile boolean switchingAccount;
    private PowerManager.WakeLock wakeLock;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());

    @Override public void onCreate() {
        super.onCreate(); current = this; lastError = "";
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel("phone-control", "Phone connection", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, PhoneReceiverActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, PhoneReceiverService.class).setAction("stop"), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder notification = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, "phone-control") : new Notification.Builder(this);
        startForeground(37183, notification.setSmallIcon(R.drawable.ic_phone_connection).setContentTitle("WLSAPlus phone connection")
            .setContentText("Enabled for your approved computer").setContentIntent(open).setOngoing(true)
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build()).build());
        wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WLSAPlus:PhoneConnection");
        wakeLock.acquire();
        worker.execute(() -> {
            try {
                bridge = Phonebridge.newBridge();
                updateNetwork();
                bridge.start(PhoneIdentity.configuration(this));
                poll();
            } catch (Exception error) { fail(error); }
        });
    }

    private void poll() {
        if (stopping) return;
        try { updateNetwork(); }
        catch (Exception error) { lastError = "Could not refresh network information. " + error.getMessage(); }
        status = bridge.status();
        handler.postDelayed(() -> { if (!stopping) worker.execute(this::poll); }, 1000);
    }

    private void updateNetwork() throws Exception {
        String next = PhoneNetworkSnapshot.capture(this);
        if (!next.equals(networkSnapshot)) {
            bridge.updateNetwork(next);
            networkSnapshot = next;
        }
    }

    static JSONObject snapshot() {
        PhoneReceiverService service = current;
        try { return new JSONObject(service == null ? "{\"state\":\"stopped\"}" : service.switchingAccount ? "{\"state\":\"switching-account\"}" : service.status); }
        catch (Exception error) { return new JSONObject(); }
    }

    void command(String action, String code) {
        if (stopping || switchingAccount) return;
        if ("switch-account".equals(action)) switchingAccount = true;
        worker.execute(() -> {
            try {
                if (bridge == null) throw new Exception("Wait for the connection to start.");
                switch (action) {
                    case "pair": bridge.allowPairing(); break;
                    case "approve": bridge.approvePair(code); break;
                    case "reject": bridge.rejectPair(); break;
                    case "forget": bridge.forget(); break;
                    case "switch-account": bridge.switchAccount(); break;
                    default: throw new Exception("Unknown phone connection command.");
                }
                lastError = ""; status = bridge.status();
            } catch (Exception error) { lastError = error.getMessage(); }
            finally {
                if (bridge != null) status = bridge.status();
                if ("switch-account".equals(action)) switchingAccount = false;
            }
        });
    }

    private void fail(Exception error) {
        lastError = "Could not start the phone connection. " + error.getMessage();
        handler.post(this::stopSelf);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && "stop".equals(intent.getAction())) stopSelf();
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        stopping = true; handler.removeCallbacksAndMessages(null);
        // Keep the old instance until its network resources are closed, preventing
        // a rapid enable/stop cycle from opening the same state twice.
        worker.execute(() -> {
            if (bridge != null) bridge.stop();
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
            if (current == this) current = null;
        });
        worker.shutdown(); stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
