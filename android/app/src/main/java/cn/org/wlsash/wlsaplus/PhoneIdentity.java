package cn.org.wlsash.wlsaplus;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.security.KeyStore;
import java.security.SecureRandom;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class PhoneIdentity {
    private static final String ALIAS = "wlsaplus-phone-identity";

    static String configuration(Context context) throws Exception {
        File directory = new File(context.getNoBackupFilesDir(), "phone-network");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create phone connection storage.");
        AtomicFile file = new AtomicFile(new File(directory, "identity.bin"));
        KeyStore keys = KeyStore.getInstance("AndroidKeyStore");
        keys.load(null);
        SecretKey key = (SecretKey) keys.getKey(ALIAS, null);
        if (key == null) {
            if (file.getBaseFile().exists()) throw new Exception("Phone connection key is unavailable. Clear app data to reset it.");
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            key = generator.generateKey();
        }
        byte[] secret;
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        if (file.getBaseFile().exists()) {
            byte[] bytes = file.readFully();
            if (bytes.length < 28) throw new Exception("Saved phone connection is damaged. Clear app data to reset it.");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, bytes, 0, 12));
            secret = cipher.doFinal(bytes, 12, bytes.length - 12);
        } else {
            secret = new byte[32]; new SecureRandom().nextBytes(secret);
            cipher.init(Cipher.ENCRYPT_MODE, key);
            FileOutputStream stream = file.startWrite();
            try { stream.write(cipher.getIV()); stream.write(cipher.doFinal(secret)); file.finishWrite(stream); }
            catch (Exception error) { file.failWrite(stream); throw error; }
        }
        if (secret.length != 32) throw new Exception("Invalid phone connection identity.");
        StringBuilder hex = new StringBuilder();
        for (byte value : secret) hex.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        byte[] digest = java.security.MessageDigest.getInstance("SHA-256").digest(secret);
        String hostname = String.format(java.util.Locale.ROOT, "wlsaplus-phone-%02x%02x%02x%02x", digest[0] & 255, digest[1] & 255, digest[2] & 255, digest[3] & 255);
        return new JSONObject().put("role", "phone").put("dir", new File(directory, "state").getAbsolutePath())
            .put("storageKey", hex.toString()).put("hostname", hostname).toString();
    }
}
