package io.github.juliamathias.pairwise;

import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.GeneralSecurityException;
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
    private final SpotifySessionStore store;
    private boolean restored;
    private boolean webReady;
    private String lastStatus = "";
    private String resumeLink = "";
    private String client = "";
    private String access = "";
    private String refresh = "";
    private long expires;

    SpotifyApi(MainActivity activity, ExecutorService worker) {
        this.activity = activity;
        this.worker = worker;
        this.store = new SpotifySessionStore(activity);
    }

    static String itemPath(String url) {
        Matcher match = ITEM.matcher(url);
        return match.find() ? match.group(1) + "/" + match.group(2) : "";
    }

    void ready() {
        worker.execute(() -> {
            restore();
            webReady = true;
            status(lastStatus);
        });
    }

    private void restore() {
        if (restored) return;
        restored = true;
        JSONObject saved = store.load("session");
        client = saved.optString("client");
        refresh = saved.optString("refresh");
    }

    private boolean connected() {
        return !access.isEmpty() || !refresh.isEmpty();
    }

    void connect(String clientId, String link) {
        worker.execute(() -> {
            restore();
            if (clientId == null || !clientId.matches("[a-fA-F0-9]{32}")) {
                status("Enter the Client ID from your Spotify developer app.");
                return;
            }
            store.saveClientId(clientId);
            String state = randomValue();
            String verifier = randomValue();
            try {
                byte[] hash = MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII));
                store.save("pending", new JSONObject().put("client", clientId).put("state", state)
                    .put("verifier", verifier).put("link", link)
                    .put("expires", System.currentTimeMillis() + 10 * 60_000));
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
                    catch (android.content.ActivityNotFoundException error) {
                        worker.execute(() -> status("Install or enable a browser to sign in to Spotify."));
                    }
                });
            } catch (GeneralSecurityException | IOException | JSONException error) {
                status("Pairwise couldn’t save the sign-in request. Try again.");
            }
        });
    }

    boolean receive(Intent intent, boolean coldStart) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return false;
        Uri uri = intent.getData();
        if (uri == null || !uri.isHierarchical() || !"io.github.juliamathias.pairwise".equals(uri.getScheme()) ||
                !"spotify-callback".equals(uri.getEncodedAuthority())) return false;
        worker.execute(() -> {
            restore();
            JSONObject pending = store.load("pending");
            if (coldStart) resumeLink = pending.optString("link");
            String state = pending.optString("state");
            if (state.isEmpty() || System.currentTimeMillis() > pending.optLong("expires")) {
                store.clear("pending");
                status("This Spotify sign-in has expired. Start again from Pairwise.");
                return;
            }
            if (!state.equals(uri.getQueryParameter("state"))) {
                status("This Spotify response belongs to a different sign-in. Use the latest Spotify tab or start again.");
                return;
            }
            store.clear("pending");
            String code = uri.getQueryParameter("code");
            if (code == null || code.isEmpty() || code.length() > 2048) {
                status("Spotify sign-in was canceled or denied.");
                return;
            }
            status("Finishing Spotify sign-in…");
            try {
                String pendingClient = pending.getString("client");
                JSONObject token = tokenRequest("grant_type=authorization_code&client_id=" + pendingClient
                    + "&code=" + Uri.encode(code) + "&code_verifier=" + pending.getString("verifier")
                    + "&redirect_uri=" + Uri.encode(REDIRECT));
                acceptToken(token, pendingClient, "");
                status(connected() ? lastStatus : "Spotify returned an empty session. Sign in again.");
            } catch (IOException | JSONException error) {
                status("Spotify couldn’t finish sign-in. Start again from Pairwise.");
            }
        });
        return true;
    }

    void disconnect() {
        worker.execute(() -> {
            store.clear("pending");
            clearSession();
            status("Disconnected from Spotify.");
        });
    }

    private void clearSession() {
        restored = true;
        client = access = refresh = "";
        expires = 0;
        store.clear("session");
    }

    private void acceptToken(JSONObject token, String clientId, String oldRefresh) throws JSONException {
        access = token.getString("access_token");
        client = clientId;
        refresh = token.optString("refresh_token", oldRefresh);
        expires = System.currentTimeMillis() + token.optLong("expires_in", 3600) * 1000;
        lastStatus = "";
        if (refresh.isEmpty()) return;
        try {
            store.save("session", new JSONObject().put("client", client).put("refresh", refresh));
        } catch (GeneralSecurityException | IOException error) {
            store.clear("session");
            lastStatus = "Spotify is connected for this session. Pairwise couldn’t save the connection.";
        }
    }

    static String catalogPath(String sharedPath) {
        if (sharedPath == null || !sharedPath.matches("(track|playlist)/[A-Za-z0-9]{22}")) return "";
        int separator = sharedPath.indexOf('/');
        return sharedPath.substring(0, separator) + "s" + sharedPath.substring(separator);
    }

    void fetchDetails(String key, String path) {
        String catalogPath = catalogPath(path);
        if (catalogPath.isEmpty() || key == null || key.length() > 200) return;
        worker.execute(() -> {
            try {
                String token = accessToken();
                if (token.isEmpty()) throw new IOException("Connect Spotify to load these details.");
                JSONObject details = new JSONObject();
                if (catalogPath.startsWith("tracks/")) {
                    JSONObject track = get(catalogPath, token);
                    details.put("creator", artistNames(track));
                    details.put("title", track.optString("name"));
                    JSONArray artists = track.optJSONArray("artists");
                    JSONObject first = artists == null ? null : artists.optJSONObject(0);
                    details.put("leadArtist", first == null ? "" : first.optString("name"));
                    details.put("duration", Math.round(track.optLong("duration_ms") / 1000.0));
                } else {
                    String owner = "";
                    try {
                        JSONObject playlist = get(catalogPath + "?fields=owner(display_name)", token);
                        JSONObject profile = playlist.optJSONObject("owner");
                        if (profile != null) owner = profile.optString("display_name");
                    } catch (SpotifySessionExpired error) {
                        throw error;
                    } catch (IOException | JSONException ignored) {
                        // The tracklist request can succeed even when owner metadata is unavailable.
                    }
                    details.put("creator", owner);
                    JSONArray rows = get(catalogPath + "/items?limit=50", token).optJSONArray("items");
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
            } catch (SpotifySessionExpired error) {
                clearSession();
                details(key, new JSONObject(), error.getMessage());
                status(error.getMessage());
            } catch (IOException error) {
                details(key, new JSONObject(), error.getMessage());
            } catch (JSONException error) {
                details(key, new JSONObject(), "Spotify returned details Pairwise couldn’t read.");
            }
        });
    }

    private String accessToken() throws IOException, JSONException {
        restore();
        if (!access.isEmpty() && System.currentTimeMillis() + 30_000 < expires) return access;
        if (refresh.isEmpty()) return "";
        try {
            JSONObject token = tokenRequest("grant_type=refresh_token&client_id=" + client + "&refresh_token=" + Uri.encode(refresh));
            acceptToken(token, client, refresh);
            return access;
        } catch (SpotifySessionExpired error) {
            clearSession();
            throw error;
        }
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
            if (status == 401 || (form != null && status == 400)) throw new SpotifySessionExpired();
            if (status == 404) throw new IOException("Spotify couldn’t find this item for your account (404).");
            if (status == 429) throw new IOException("Spotify is rate-limiting lookups (429). Try again in a moment.");
            if (status != 200) throw new IOException("Spotify couldn’t load the details (HTTP " + status + ").");
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

    private void status(String message) {
        lastStatus = message;
        if (!webReady) return;
        String call = "window.pairwiseSpotifyStatus?.(" + connected() + "," + JSONObject.quote(message)
            + "," + JSONObject.quote(store.clientId()) + "," + JSONObject.quote(resumeLink) + ")";
        resumeLink = "";
        activity.runOnUiThread(() -> activity.runScript(call));
    }

    private static final class SpotifySessionExpired extends IOException {
        SpotifySessionExpired() { super("Spotify authorization expired. Sign in again."); }
    }

    private void details(String key, JSONObject result, String error) {
        activity.runOnUiThread(() -> activity.runScript("window.pairwiseSpotifyDetails?.("
            + JSONObject.quote(key) + "," + JSONObject.quote(result.toString()) + "," + JSONObject.quote(error == null ? "Couldn’t load Spotify details." : error) + ")"));
    }
}
