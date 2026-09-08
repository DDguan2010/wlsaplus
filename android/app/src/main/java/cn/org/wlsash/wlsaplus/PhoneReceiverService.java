package cn.org.wlsash.wlsaplus;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
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
    // Serialize cleanup and startup even when Android replaces a Service instance.
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();
    private Bridge bridge;
    private volatile String status = "{\"state\":\"connecting\"}";
    private volatile boolean stopping;
    private PowerManager.WakeLock wakeLock;
    private ConnectivityManager connectivity;
    private ConnectivityManager.NetworkCallback networkCallback;
    private boolean started;
    private int failures;
    private long bridgeGeneration;
    private final android.os.Handler handler = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable retry = () -> worker.execute(this::startBridge);
    private final Runnable networkChanged = () -> worker.execute(() -> {
        if (!stopping && bridge != null) {
            try { bridge.networkChanged(); } catch (Exception error) { recover(error); }
        }
    });

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
    }

    private void startBridge() {
        if (stopping || bridge != null) return;
        long generation = ++bridgeGeneration;
        try {
            bridge = Phonebridge.newBridge();
            bridge.start(PhoneIdentity.configuration(this));
            lastError = "";
            poll(generation);
        } catch (Exception error) { recover(error); }
    }

    private void poll(long generation) {
        if (stopping || generation != bridgeGeneration) return;
        try {
            status = bridge.status();
            failures = 0;
            handler.postDelayed(() -> { if (!stopping) worker.execute(() -> poll(generation)); }, 1000);
        } catch (Exception error) { recover(error); }
    }

    static JSONObject snapshot() {
        PhoneReceiverService service = current;
        try { return new JSONObject(service == null ? "{\"state\":\"stopped\"}" : service.status); }
        catch (Exception error) { return new JSONObject(); }
    }

    void command(String action, String code) {
        if (stopping) return;
        worker.execute(() -> {
            try {
                if (bridge == null) throw new Exception("Wait for the connection to start.");
                switch (action) {
                    case "pair": bridge.allowPairing(); break;
                    case "approve": bridge.approvePair(code); break;
                    case "reject": bridge.rejectPair(); break;
                    case "forget": bridge.forget(); break;
                    default: throw new Exception("Unknown phone connection command.");
                }
                lastError = ""; status = bridge.status();
            } catch (Exception error) { lastError = error.getMessage(); }
        });
    }

    private void recover(Exception error) {
        if (stopping) return;
        bridgeGeneration++;
        lastError = "Phone connection interrupted. Retrying automatically. " + error.getMessage();
        status = "{\"state\":\"connecting\"}";
        if (bridge != null) {
            try { bridge.stop(); } catch (Exception ignored) { }
            bridge = null;
        }
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, Math.min(30000, 1000L << Math.min(failures++, 5)));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        android.content.SharedPreferences preferences = getSharedPreferences("phone-connection", MODE_PRIVATE);
        if (intent != null && "stop".equals(intent.getAction())) {
            preferences.edit().putBoolean("enabled", false).commit();
            stopSelf();
            return START_NOT_STICKY;
        }
        // A null intent is Android recreating a service it killed, not new consent.
        if (intent == null && !preferences.getBoolean("enabled", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        preferences.edit().putBoolean("enabled", true).commit();
        if (!started) {
            started = true;
            wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WLSAPlus:PhoneConnection");
            wakeLock.acquire();
            connectivity = getSystemService(ConnectivityManager.class);
            networkCallback = new ConnectivityManager.NetworkCallback() {
                private void changed() {
                    if (stopping) return;
                    handler.removeCallbacks(networkChanged);
                    handler.postDelayed(networkChanged, 500);
                }
                @Override public void onAvailable(Network network) { changed(); }
                @Override public void onLost(Network network) { changed(); }
            };
            try { connectivity.registerDefaultNetworkCallback(networkCallback); }
            catch (RuntimeException error) { networkCallback = null; }
            worker.execute(this::startBridge);
        }
        return START_STICKY;
    }

    @Override public void onDestroy() {
        stopping = true; handler.removeCallbacksAndMessages(null);
        if (connectivity != null && networkCallback != null) {
            connectivity.unregisterNetworkCallback(networkCallback);
            networkCallback = null;
        }
        // Keep the old instance until its network resources are closed, preventing
        // a rapid enable/stop cycle from opening the same state twice.
        worker.execute(() -> {
            try { if (bridge != null) bridge.stop(); }
            finally {
                bridge = null;
                if (current == this) current = null;
            }
        });
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
