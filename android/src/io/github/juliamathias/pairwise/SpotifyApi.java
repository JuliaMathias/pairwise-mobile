package io.github.juliamathias.pairwise;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.StringJoiner;
import java.util.concurrent.ExecutorService;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

final class SpotifyApi {
    static final String REDIRECT = "io.github.juliamathias.pairwise://spotify-callback";
    private static final Pattern ITEM = Pattern.compile("/(track|playlist)/([A-Za-z0-9]{22})(?:[?/#\" ]|$)");
    private static final String ACCOUNTS = "https://accounts.spotify.com";
    private final MainActivity activity;
    private final ExecutorService worker;
    private final SecureRandom random = new SecureRandom();
    private String state = "";
    private String verifier = "";
    private String pendingClient = "";
    private long pendingUntil;
    private String client = "";
    private String access = "";
    private String refresh = "";
    private long expires;

    SpotifyApi(MainActivity activity, ExecutorService worker) {
        this.activity = activity;
        this.worker = worker;
    }

    static String itemPath(String url) {
        Matcher match = ITEM.matcher(url);
        return match.find() ? match.group(1) + "/" + match.group(2) : "";
    }

    void connect(String clientId) {
        worker.execute(() -> {
            if (clientId == null || !clientId.matches("[a-fA-F0-9]{32}")) {
                status(!access.isEmpty(), "Enter the Client ID from your Spotify developer app.");
                return;
            }
            pendingClient = clientId;
            state = randomValue();
            verifier = randomValue();
            pendingUntil = System.currentTimeMillis() + 10 * 60_000;
            try {
                byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
                Uri url = Uri.parse(ACCOUNTS + "/authorize").buildUpon()
                    .appendQueryParameter("client_id", clientId)
                    .appendQueryParameter("response_type", "code")
                    .appendQueryParameter("redirect_uri", REDIRECT)
                    .appendQueryParameter("code_challenge_method", "S256")
                    .appendQueryParameter("code_challenge", encode(hash))
                    .appendQueryParameter("state", state)
                    .appendQueryParameter("scope", "playlist-read-private playlist-read-collaborative")
                    .build();
                activity.runOnUiThread(() -> {
                    try { activity.startActivity(new Intent(Intent.ACTION_VIEW, url)); }
                    catch (android.content.ActivityNotFoundException error) { status(false, "Open Spotify sign-in with a browser."); }
                });
            } catch (NoSuchAlgorithmException error) {
                status(false, "Spotify sign-in could not start.");
            }
        });
    }

    boolean receive(Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return false;
        Uri uri = intent.getData();
        if (uri == null || !REDIRECT.equals(uri.buildUpon().clearQuery().fragment(null).build().toString())) return false;
        worker.execute(() -> {
            if (state.isEmpty() || System.currentTimeMillis() > pendingUntil ||
                    !state.equals(uri.getQueryParameter("state"))) return;
            state = "";
            String code = uri.getQueryParameter("code");
            try {
                if (code == null || code.isEmpty() || code.length() > 2048) {
                    status(!access.isEmpty(), "Spotify sign-in was canceled.");
                    return;
                }
                JSONObject token = tokenRequest("grant_type=authorization_code&client_id=" + pendingClient
                    + "&code=" + Uri.encode(code) + "&code_verifier=" + verifier + "&redirect_uri=" + Uri.encode(REDIRECT));
                String newAccess = token.getString("access_token");
                client = pendingClient;
                refresh = token.optString("refresh_token");
                access = newAccess;
                expires = System.currentTimeMillis() + token.optLong("expires_in", 3600) * 1000;
                status(true, "");
            } catch (IOException | JSONException error) {
                status(!access.isEmpty(), "Spotify sign-in failed. Check the Client ID and callback in your developer settings.");
            } finally {
                verifier = "";
                pendingClient = "";
            }
        });
        return true;
    }

    void disconnect() {
        worker.execute(() -> {
            client = access = refresh = state = verifier = pendingClient = "";
            status(false, "Disconnected from Spotify.");
        });
    }

    void fetchDetails(String key, String path) {
        if (path == null || !path.matches("(track|playlist)/[A-Za-z0-9]{22}") || key == null || key.length() > 200) return;
        worker.execute(() -> {
            try {
                String token = accessToken();
                if (token.isEmpty()) throw new IOException("Connect Spotify to load these details.");
                JSONObject details = new JSONObject();
                if (path.startsWith("track/")) {
                    JSONObject track = get("tracks/" + path.substring(6), token);
                    details.put("creator", artistNames(track));
                    details.put("title", track.optString("name"));
                    JSONArray artists = track.optJSONArray("artists");
                    JSONObject first = artists == null ? null : artists.optJSONObject(0);
                    details.put("leadArtist", first == null ? "" : first.optString("name"));
                    details.put("duration", Math.round(track.optLong("duration_ms") / 1000.0));
                } else {
                    String owner = "";
                    try {
                        JSONObject playlist = get(path + "?fields=owner(display_name)", token);
                        JSONObject profile = playlist.optJSONObject("owner");
                        if (profile != null) owner = profile.optString("display_name");
                    } catch (IOException | JSONException ignored) {
                        // The tracklist request can succeed even when owner metadata is unavailable.
                    }
                    details.put("creator", owner);
                    JSONArray rows = get(path + "/items?limit=50", token).optJSONArray("items");
                    JSONArray entries = new JSONArray();
                    for (int i = 0; rows != null && i < rows.length(); i++) {
                        JSONObject row = rows.optJSONObject(i);
                        if (row == null) continue;
                        JSONObject item = row.optJSONObject("item");
                        if (item == null) item = row.optJSONObject("track");
                        if (item == null || item.optString("name").isEmpty()) continue;
                        String artists = artistNames(item);
                        entries.put(item.optString("name") + (artists.isEmpty() ? "" : " — " + artists));
                    }
                    details.put("entries", entries);
                }
                details(key, details, "");
            } catch (IOException error) {
                details(key, new JSONObject(), error.getMessage());
            } catch (JSONException error) {
                details(key, new JSONObject(), "Spotify returned details Pairwise couldn’t read.");
            }
        });
    }

    private String accessToken() throws IOException, JSONException {
        if (access.isEmpty() || System.currentTimeMillis() + 30_000 < expires) return access;
        if (refresh.isEmpty()) return "";
        JSONObject token = tokenRequest("grant_type=refresh_token&client_id=" + client + "&refresh_token=" + Uri.encode(refresh));
        access = token.getString("access_token");
        refresh = token.optString("refresh_token", refresh);
        expires = System.currentTimeMillis() + token.optLong("expires_in", 3600) * 1000;
        return access;
    }

    private static String artistNames(JSONObject track) {
        JSONArray artists = track.optJSONArray("artists");
        StringJoiner names = new StringJoiner(", ");
        for (int i = 0; artists != null && i < artists.length(); i++) {
            JSONObject artist = artists.optJSONObject(i);
            if (artist != null && !artist.optString("name").isEmpty()) names.add(artist.optString("name"));
        }
        return names.toString();
    }

    private static JSONObject get(String path, String access) throws IOException, JSONException {
        return request("https://api.spotify.com/v1/" + path, access, null);
    }

    private static JSONObject tokenRequest(String form) throws IOException, JSONException {
        return request(ACCOUNTS + "/api/token", null, form);
    }

    private static JSONObject request(String url, String access, String form) throws IOException, JSONException {
        HttpsURLConnection connection = (HttpsURLConnection) new URL(url).openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            if (access != null) connection.setRequestProperty("Authorization", "Bearer " + access);
            if (form != null) {
                connection.setRequestMethod("POST");
                connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
                connection.setDoOutput(true);
                try (java.io.OutputStream output = connection.getOutputStream()) {
                    output.write(form.getBytes(StandardCharsets.UTF_8));
                }
            }
            int status = connection.getResponseCode();
            if (status == 403) throw new IOException("Spotify restricts playlist tracks to owners and collaborators, and development apps to approved accounts.");
            if (status == 401) throw new IOException("Spotify authorization expired. Reconnect your account.");
            if (status != 200) throw new IOException("Spotify details aren’t available right now.");
            return new JSONObject(new String(IncomingShare.read(connection.getInputStream(), 4 * 1024 * 1024), StandardCharsets.UTF_8));
        } catch (java.net.SocketTimeoutException error) {
            throw new IOException("Spotify took too long to respond. Try again.");
        } finally {
            connection.disconnect();
        }
    }

    private String randomValue() {
        byte[] data = new byte[32];
        random.nextBytes(data);
        return encode(data);
    }

    private static String encode(byte[] data) {
        return Base64.encodeToString(data, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private void status(boolean connected, String message) {
        activity.runOnUiThread(() -> activity.runScript("window.pairwiseSpotifyStatus?.("
            + connected + "," + JSONObject.quote(message) + ")"));
    }

    private void details(String key, JSONObject result, String error) {
        activity.runOnUiThread(() -> activity.runScript("window.pairwiseSpotifyDetails?.("
            + JSONObject.quote(key) + "," + JSONObject.quote(result.toString()) + "," + JSONObject.quote(error == null ? "Couldn’t load Spotify details." : error) + ")"));
    }
}
