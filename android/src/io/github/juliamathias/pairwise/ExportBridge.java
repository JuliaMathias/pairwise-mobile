package io.github.juliamathias.pairwise;

import android.net.Uri;
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
        activity.runOnUiThread(() -> {
            synchronized (ExportBridge.this) {
                if (pending == export) activity.chooseExportLocation(export.name, export.mime);
            }
        });
        return true;
    }

    @JavascriptInterface
    public synchronized void cancelSave(String id) {
        if (matches(id) && !pending.copying) clear();
    }

    synchronized void destination(Uri uri, String failure) {
        if (pending == null || pending.stream != null || pending.copying) return;
        Pending export = pending;
        if (uri == null) {
            clear();
            activity.exportFinished(export.id, failure);
            return;
        }

        export.copying = true;
        writer.execute(() -> {
            String result = "saved";
            try (FileInputStream source = new FileInputStream(export.file);
                 OutputStream destination = activity.getContentResolver().openOutputStream(uri, "w")) {
                if (destination == null) throw new IOException("Destination could not be opened");
                byte[] buffer = new byte[65_536];
                int count;
                while ((count = source.read(buffer)) != -1) destination.write(buffer, 0, count);
            } catch (IOException | SecurityException error) {
                result = "Couldn't finish writing the file.";
                try {
                    android.provider.DocumentsContract.deleteDocument(activity.getContentResolver(), uri);
                } catch (IOException | RuntimeException ignored) {
                    // The document provider may not support removing a failed export.
                }
            } finally {
                synchronized (this) {
                    if (pending == export) clear();
                }
            }
            String status = result;
            activity.runOnUiThread(() -> activity.exportFinished(export.id, status));
        });
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
