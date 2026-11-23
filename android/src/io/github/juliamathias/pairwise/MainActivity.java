package io.github.juliamathias.pairwise;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ROOT = "/app/";
    private static final String START = "https://" + HOST + ROOT + "index.html";
    private static final int PICK_PHOTOS = 41;

    private WebView webView;
    private ExportBridge exportBridge;
    private ValueCallback<Uri[]> photoCallback;
    private volatile int requestedPhotoLimit;

    @Override
    public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setDecorFitsSystemWindows(false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(246, 248, 241));
        root.setOnApplyWindowInsetsListener((view, windowInsets) -> {
            WindowInsetsController controller = view.getWindowInsetsController();
            if (controller != null) {
                int lightBars = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                controller.setSystemBarsAppearance(lightBars, lightBars);
            }
            android.graphics.Insets insets = windowInsets.getInsets(
                WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout()
                    | WindowInsets.Type.ime()
            );
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(246, 248, 241));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        webView.setWebViewClient(new LocalAssets());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                return selectPhotos(callback, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
            }
        });
        exportBridge = new ExportBridge(this);
        webView.addJavascriptInterface(exportBridge, "PairwiseAndroid");
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        webView.loadUrl(START);
    }

    void setPhotoLimit(int count) {
        requestedPhotoLimit = Math.max(0, Math.min(9, count));
    }

    private boolean selectPhotos(ValueCallback<Uri[]> callback, boolean multiple) {
        if (photoCallback != null) photoCallback.onReceiveValue(null);
        photoCallback = callback;
        int limit = requestedPhotoLimit;
        requestedPhotoLimit = 0;
        if (Build.VERSION.SDK_INT >= 33) {
            Intent photoPicker = new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*");
            if (multiple && limit != 1) {
                int deviceMax = MediaStore.getPickImagesMaxLimit();
                photoPicker.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, limit > 1 ? Math.min(limit, deviceMax) : deviceMax);
            }
            try {
                startActivityForResult(photoPicker, PICK_PHOTOS);
                return true;
            } catch (ActivityNotFoundException ignored) {
                // Devices without the photo picker can still use the system document picker.
            }
        }
        Intent documents = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
            .setType("image/*").putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple && limit != 1);
        try {
            startActivityForResult(documents, PICK_PHOTOS);
        } catch (ActivityNotFoundException unavailable) {
            photoCallback = null;
            callback.onReceiveValue(null);
        }
        return true;
    }

    void exportFinished(String id, String status) {
        if (isFinishing() || isDestroyed()) return;
        webView.evaluateJavascript(
            "window.pairwiseAndroidSaveResult?.(" + org.json.JSONObject.quote(id)
                + "," + org.json.JSONObject.quote(status) + ")",
            null
        );
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_PHOTOS || photoCallback == null) return;
        ValueCallback<Uri[]> callback = photoCallback;
        photoCallback = null;
        List<Uri> selected = new ArrayList<>();
        if (result == RESULT_OK && data != null) {
            ClipData clips = data.getClipData();
            if (clips != null) {
                for (int i = 0; i < clips.getItemCount(); i++) {
                    Uri uri = clips.getItemAt(i).getUri();
                    if (isContent(uri)) selected.add(uri);
                }
            } else if (isContent(data.getData())) {
                selected.add(data.getData());
            }
        }
        callback.onReceiveValue(selected.isEmpty() ? null : selected.toArray(new Uri[0]));
    }

    private boolean isContent(Uri uri) {
        return uri != null && "content".equals(uri.getScheme());
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(
            "(() => {const dialog=document.querySelector('dialog[open]');"
                + "if(dialog){dialog.close();return true;}"
                + "if(location.hash){location.hash='';return true;}return false;})()",
            handled -> { if (!"true".equals(handled)) finish(); }
        );
    }

    @Override
    protected void onDestroy() {
        if (photoCallback != null) photoCallback.onReceiveValue(null);
        if (exportBridge != null) exportBridge.close();
        if (webView != null) {
            if (webView.getParent() instanceof FrameLayout) ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class LocalAssets extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            return !trusted(url) || !(ROOT + "index.html").equals(url.getPath());
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            // Android grants read access only to content selected in the system picker.
            if (isContent(url) && !request.isForMainFrame()) return null;
            if (!trusted(url) || !"GET".equals(request.getMethod())) return missing();
            String path = url.getPath();
            if (path == null || !path.startsWith(ROOT)) return missing();
            String filename = path.substring(ROOT.length());
            if (!filename.matches("[a-z][a-z0-9-]*\\.(html|css|mjs)")) return missing();
            String type = filename.endsWith(".mjs") ? "text/javascript"
                : filename.endsWith(".css") ? "text/css" : "text/html";
            try {
                InputStream stream = getAssets().open(filename);
                return new WebResourceResponse(type, "UTF-8", 200, "OK", Map.of(
                    "Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: content:; base-uri 'none'; frame-src 'none'; form-action 'none'",
                    "X-Content-Type-Options", "nosniff"
                ), stream);
            } catch (IOException absent) {
                return missing();
            }
        }

        private boolean trusted(Uri url) {
            return "https".equals(url.getScheme()) && HOST.equals(url.getHost()) && url.getPort() == -1;
        }

        private WebResourceResponse missing() {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(),
                new ByteArrayInputStream(new byte[0]));
        }
    }
}
