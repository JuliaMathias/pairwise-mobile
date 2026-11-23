package io.github.juliamathias.pairwise;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONException;
import org.json.JSONObject;

final class SpotifySessionStore {
    private static final String KEY_ALIAS = "pairwise.spotify.session.v1";
    private final SharedPreferences preferences;

    SpotifySessionStore(Context context) {
        preferences = context.getSharedPreferences("spotify", Context.MODE_PRIVATE);
    }

    String clientId() {
        return preferences.getString("client_id", "");
    }

    void saveClientId(String clientId) {
        preferences.edit().putString("client_id", clientId).apply();
    }

    JSONObject load(String name) {
        String value = preferences.getString(name, null);
        if (value == null) return new JSONObject();
        try {
            String[] parts = value.split(":", 2);
            if (parts.length != 2) throw new GeneralSecurityException("Missing IV");
            SecretKey key = key(false);
            if (key == null) throw new GeneralSecurityException("Missing key");
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
            cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
            byte[] clear = cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP));
            return new JSONObject(new String(clear, StandardCharsets.UTF_8));
        } catch (GeneralSecurityException | IOException | JSONException | IllegalArgumentException error) {
            clear(name);
            return new JSONObject();
        }
    }

    void save(String name, JSONObject contents) throws GeneralSecurityException, IOException {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key(true));
        cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
        byte[] encrypted = cipher.doFinal(contents.toString().getBytes(StandardCharsets.UTF_8));
        String value = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP);
        if (!preferences.edit().putString(name, value).commit()) throw new IOException("Couldn’t save Spotify data");
    }

    void clear(String name) {
        preferences.edit().remove(name).commit();
    }

    private SecretKey key(boolean create) throws GeneralSecurityException, IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey key = (SecretKey) store.getKey(KEY_ALIAS, null);
        if (key != null || !create) return key;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(256)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
