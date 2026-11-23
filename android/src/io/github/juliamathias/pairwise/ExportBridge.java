package io.github.juliamathias.pairwise;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class ExportBridge {
    private static final String TEMP_PREFIX = "pairwise-export-";
    private static final int MAX_ENCODED_CHUNK = 262_144;
    private final MainActivity activity;
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private Pending pending;

    ExportBridge(MainActivity activity) {
        this.activity = activity;
        File[] abandoned = activity.getCacheDir().listFiles((directory, name) -> name.startsWith(TEMP_PREFIX));
        if (abandoned != null) {
            long cutoff = System.currentTimeMillis() - 86_400_000L;
            for (File file : abandoned) if (file.lastModified() < cutoff) file.delete();
        }
    }

    @JavascriptInterface
    public void setPhotoLimit(int count) {
        activity.setPhotoLimit(count);
    }

    @JavascriptInterface
    public synchronized String beginSave(String filename) {
        if (pending != null || filename == null || filename.trim().isEmpty() || filename.length() > 200
            || filename.contains("/") || filename.contains("\\")) return "";
        String suffix = filename.toLowerCase(Locale.ROOT);
        String mime = suffix.endsWith(".png") ? "image/png" : suffix.endsWith(".zip") ? "application/zip" : "";
        if (mime.isEmpty()) return "";

        File file = null;
        try {
            file = File.createTempFile(TEMP_PREFIX, ".tmp", activity.getCacheDir());
            pending = new Pending(filename, mime, file, new FileOutputStream(file));
            return pending.id;
        } catch (IOException error) {
            if (file != null) file.delete();
            return "";
        }
    }

    @JavascriptInterface
    public synchronized boolean appendSave(String id, String data) {
        if (!matches(id) || pending.stream == null || data == null || data.length() > MAX_ENCODED_CHUNK) return false;
        try {
            pending.stream.write(Base64.decode(data, Base64.DEFAULT));
            return true;
        } catch (IOException | IllegalArgumentException error) {
            clear();
            return false;
        }
    }

    @JavascriptInterface
    public synchronized boolean finishSave(String id) {
        if (!matches(id) || pending.stream == null) return false;
        try {
            pending.stream.close();
            pending.stream = null;
        } catch (IOException error) {
            clear();
            return false;
        }

        Pending export = pending;
        export.copying = true;
        writer.execute(() -> saveToDownloads(export));
        return true;
    }

    @JavascriptInterface
    public synchronized void cancelSave(String id) {
        if (matches(id) && !pending.copying) clear();
    }

    private void saveToDownloads(Pending export) {
        ContentResolver resolver = activity.getContentResolver();
        Uri uri = null;
        String result = "saved";
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, export.name);
            values.put(MediaStore.MediaColumns.MIME_TYPE, export.mime);
            values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/");
            values.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = resolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), values);
            if (uri == null) throw new IOException("Could not create download");
            try (FileInputStream source = new FileInputStream(export.file);
                 OutputStream destination = resolver.openOutputStream(uri, "w")) {
                if (destination == null) throw new IOException("Could not open download");
                byte[] buffer = new byte[65_536];
                int count;
                while ((count = source.read(buffer)) != -1) destination.write(buffer, 0, count);
            }
            values.clear();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            if (resolver.update(uri, values, null, null) != 1) throw new IOException("Could not publish download");
        } catch (IOException | RuntimeException error) {
            result = "Couldn’t save the file to Downloads.";
            if (uri != null) {
                try {
                    resolver.delete(uri, null, null);
                } catch (RuntimeException ignored) {
                    // A failed export must not prevent the next save.
                }
            }
        } finally {
            synchronized (this) {
                if (pending == export) clear();
            }
        }
        String status = result;
        activity.runOnUiThread(() -> activity.exportFinished(export.id, status));
    }

    synchronized void close() {
        if (pending != null && !pending.copying) clear();
        writer.shutdown();
    }

    private boolean matches(String id) {
        return pending != null && pending.id.equals(id);
    }

    private void clear() {
        if (pending.stream != null) {
            try {
                pending.stream.close();
            } catch (IOException ignored) {
                // The staging file is disposable.
            }
        }
        pending.file.delete();
        pending = null;
    }

    private static final class Pending {
        final String id = UUID.randomUUID().toString();
        final String name;
        final String mime;
        final File file;
        FileOutputStream stream;
        boolean copying;

        Pending(String name, String mime, File file, FileOutputStream stream) {
            this.name = name;
            this.mime = mime;
            this.file = file;
            this.stream = stream;
        }
    }
}
