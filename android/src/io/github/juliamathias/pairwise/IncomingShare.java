package io.github.juliamathias.pairwise;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

public final class IncomingShare {
    private static final int SHARED_IMAGE_LIMIT = 32 * 1024 * 1024;
    private final MainActivity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final SpotifyApi spotify;
    private volatile ImagePayload incomingImage;
    private volatile ImagePayload coverImage;
    private JSONObject pendingShare;
    private boolean ready;

    IncomingShare(MainActivity activity) {
        this.activity = activity;
        spotify = new SpotifyApi(activity, worker);
    }

    @JavascriptInterface
    public void ready() {
        activity.runOnUiThread(() -> {
            ready = true;
            deliver();
        });
    }

    void receive(Intent intent) {
        if (intent == null || spotify.receive(intent) || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String type = intent.getType();
        CharSequence extra = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        String text = extra == null ? "" : extra.subSequence(0, Math.min(4096, extra.length())).toString();
        Uri stream = sharedUri(intent);
        worker.execute(() -> {
            JSONObject message = new JSONObject();
            try {
                message.put("text", text);
                if (type != null && type.startsWith("image/") && stream != null && "content".equals(stream.getScheme())) {
                    byte[] bytes = read(activity.getContentResolver().openInputStream(stream), SHARED_IMAGE_LIMIT);
                    incomingImage = new ImagePayload(bytes, imageMime(bytes));
                    message.put("image", incomingImage.id);
                    message.put("name", "shared-image");
                }
            } catch (IOException | RuntimeException | JSONException error) {
                try { message.put("error", "Couldn’t open the shared image. Add it from Photos instead."); }
                catch (JSONException ignored) { return; }
            }
            activity.runOnUiThread(() -> {
                pendingShare = message;
                deliver();
            });
        });
    }

    @SuppressWarnings("deprecation")
    private Uri sharedUri(Intent intent) {
        android.os.Parcelable extra = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (extra instanceof Uri) return (Uri) extra;
        ClipData clip = intent.getClipData();
        return clip != null && clip.getItemCount() > 0 ? clip.getItemAt(0).getUri() : null;
    }

    private void deliver() {
        if (!ready || pendingShare == null) return;
        String json = pendingShare.toString();
        activity.runScript("window.pairwiseReceiveShare?.(JSON.parse(" + JSONObject.quote(json) + "))");
        pendingShare = null;
    }

    @JavascriptInterface
    public void copyLink(String link) {
        if (!validLink(link)) return;
        activity.runOnUiThread(() -> {
            android.content.ClipboardManager clipboard = activity.getSystemService(android.content.ClipboardManager.class);
            if (clipboard != null) clipboard.setPrimaryClip(ClipData.newPlainText("Spotify link", link));
        });
    }

    @JavascriptInterface
    public void fetchCard(String link) {
        if (!validLink(link)) {
            sendCard("", "", link, "", "", "", "Use a Spotify song or playlist link.");
            return;
        }
        worker.execute(() -> {
            try {
                URL endpoint = new URL("https://open.spotify.com/oembed?url=" + Uri.encode(link));
                byte[] metadata = fetch(endpoint, 64 * 1024);
                JSONObject embed = new JSONObject(new String(metadata, StandardCharsets.UTF_8));
                String title = embed.getString("title");
                String path = SpotifyApi.itemPath(link);
                if (path.isEmpty()) path = SpotifyApi.itemPath(embed.optString("iframe_url") + " " + embed.optString("html"));
                String kind = path.startsWith("playlist/") ? "playlist" : "track";
                String creator = embed.optString("author_name");
                URL cover = new URL(embed.getString("thumbnail_url"));
                String host = cover.getHost().toLowerCase(Locale.ROOT);
                if (!"https".equals(cover.getProtocol()) || cover.getPort() != -1 || cover.getUserInfo() != null
                    || !(host.equals("i.scdn.co") || host.equals("mosaic.scdn.co") || host.endsWith(".spotifycdn.com"))) {
                    throw new IOException("Unknown cover host");
                }
                byte[] bytes = fetch(cover, 3 * 1024 * 1024);
                coverImage = new ImagePayload(bytes, imageMime(bytes));
                sendCard(coverImage.id, title, link, kind, creator, path, "");
            } catch (IOException | RuntimeException | JSONException error) {
                sendCard("", "", link, "", "", "", "Couldn’t get the title and cover from Spotify. You can still add a screenshot.");
            }
        });
    }

    @JavascriptInterface
    public void connectSpotify(String clientId) { spotify.connect(clientId); }

    @JavascriptInterface
    public void disconnectSpotify() { spotify.disconnect(); }

    @JavascriptInterface
    public void fetchSpotifyDetails(String key, String path) { spotify.fetchDetails(key, path); }

    @JavascriptInterface
    public void fetchLyrics(String key, String title, String artist) {
        if (key == null || key.length() > 200 || title == null || title.trim().isEmpty() || title.length() > 300 ||
                artist == null || artist.length() > 200) return;
        worker.execute(() -> {
            String result = "[]";
            String error = "";
            try {
                Uri.Builder url = Uri.parse("https://lrclib.net/api/search").buildUpon()
                    .appendQueryParameter("track_name", title);
                if (!artist.trim().isEmpty()) url.appendQueryParameter("artist_name", artist);
                byte[] response = fetch(new URL(url.build().toString()), 2 * 1024 * 1024);
                JSONArray matches = new JSONArray(new String(response, StandardCharsets.UTF_8));
                JSONArray compact = new JSONArray();
                for (int i = 0; i < Math.min(20, matches.length()); i++) {
                    JSONObject match = matches.optJSONObject(i);
                    if (match == null) continue;
                    String lyrics = match.optString("plainLyrics");
                    if (lyrics.trim().isEmpty() || match.optBoolean("instrumental")) continue;
                    compact.put(new JSONObject()
                        .put("trackName", match.optString("trackName"))
                        .put("artistName", match.optString("artistName"))
                        .put("albumName", match.optString("albumName"))
                        .put("duration", match.optInt("duration"))
                        .put("plainLyrics", lyrics.substring(0, Math.min(8000, lyrics.length()))));
                }
                result = compact.toString();
            } catch (IOException | JSONException failure) {
                error = "Couldn’t reach LRCLIB. Try again or paste lyrics below.";
            }
            String values = result;
            String message = error;
            activity.runOnUiThread(() -> activity.runScript("window.pairwiseLyrics?.("
                + JSONObject.quote(key) + "," + JSONObject.quote(values) + "," + JSONObject.quote(message) + ")"));
        });
    }

    private boolean validLink(String link) {
        return link != null && link.length() < 200 && link.matches(
            "https://(?:open\\.spotify\\.com/(?:intl-[a-z]{2}/)?(?:track|playlist)/[A-Za-z0-9]{22}|spotify\\.link/[A-Za-z0-9_-]+)"
        );
    }

    private void sendCard(String id, String title, String link, String kind, String creator, String path, String error) {
        activity.runOnUiThread(() -> activity.runScript("window.pairwiseShareCard?.("
            + JSONObject.quote(id) + "," + JSONObject.quote(title) + "," + JSONObject.quote(link) + "," + JSONObject.quote(kind) + ","
            + JSONObject.quote(creator) + "," + JSONObject.quote(path) + "," + JSONObject.quote(error) + ")"));
    }

    WebResourceResponse asset(String id) {
        ImagePayload image = incomingImage;
        if (image == null || !image.id.equals(id)) image = coverImage;
        if (image == null || !image.id.equals(id)) return null;
        return new WebResourceResponse(image.mime, null, 200, "OK", Map.of("Cache-Control", "no-store", "X-Content-Type-Options", "nosniff"),
            new ByteArrayInputStream(image.bytes));
    }

    void close() {
        worker.shutdownNow();
    }

    private static String imageMime(byte[] bytes) throws IOException {
        if (bytes.length < 16) throw new IOException("Invalid image");
        if ((bytes[0] & 255) == 0x89 && marker(bytes, 1, "PNG")) return "image/png";
        if ((bytes[0] & 255) == 0xff && (bytes[1] & 255) == 0xd8) return "image/jpeg";
        if (marker(bytes, 0, "GIF8")) return "image/gif";
        if (marker(bytes, 0, "RIFF") && marker(bytes, 8, "WEBP")) return "image/webp";
        if (marker(bytes, 4, "ftyp") && (marker(bytes, 8, "avif") || marker(bytes, 8, "avis"))) return "image/avif";
        if (marker(bytes, 0, "BM")) return "image/bmp";
        throw new IOException("Unsupported image format");
    }

    private static boolean marker(byte[] bytes, int offset, String signature) {
        for (int index = 0; index < signature.length(); index++) {
            if (bytes[offset + index] != signature.charAt(index)) return false;
        }
        return true;
    }

    private static byte[] fetch(URL url, int limit) throws IOException {
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            if ("lrclib.net".equals(url.getHost())) {
                connection.setRequestProperty("User-Agent", "Pairwise/1.4.0 (https://github.com/JuliaMathias/pairwise-mobile)");
            }
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(8000);
            if (connection.getResponseCode() != 200) throw new IOException("Request failed");
            return read(connection.getInputStream(), limit);
        } finally {
            connection.disconnect();
        }
    }

    static byte[] read(InputStream source, int limit) throws IOException {
        if (source == null) throw new IOException("No stream");
        try (InputStream stream = source; ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
            byte[] chunk = new byte[16 * 1024];
            int count;
            while ((count = stream.read(chunk)) != -1) {
                if (buffer.size() + count > limit) throw new IOException("Image is too large");
                buffer.write(chunk, 0, count);
            }
            return buffer.toByteArray();
        }
    }

    private static final class ImagePayload {
        final String id = UUID.randomUUID().toString();
        final byte[] bytes;
        final String mime;

        ImagePayload(byte[] bytes, String mime) {
            this.bytes = bytes;
            this.mime = mime;
        }
    }
}
