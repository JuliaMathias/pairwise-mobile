# Pairwise Mobile

Pairwise is a phone-first prototype for joining images and making collages. Both tools run entirely on-device and appear in the mode picker.

## Join images

Use the sample images or select your own, choose a layout and group size, then save a single PNG, save all images as separate PNGs, or download a ZIP. Browsers may prompt for permission to download multiple individual files.

Pairwise starts in natural filename order. Drag an image by its grip or use the arrow buttons to reorder it across groups, and use **Sort by name** to restore filename order. Use **Crop** on any image to choose a freeform or fixed-ratio region. **Reset crop** restores the full image when applied.

The **Live preview** shows each group's exact layout and output dimensions as you crop, reorder, or change the join direction. Join preserves cropped pixels with transparent padding or a solid background, or scales each image proportionally to the widest image in a stack or the tallest image in a row. An optional colored border frames and separates the images. Exports include the final partial group. Use **File naming** for an optional prefix and number offset.

## Make a collage

Import up to nine photos to set the slot count automatically, or choose a template and tap each empty slot to import one photo. Pairwise shows layouts with the exact slot count and puts those with less extreme cell proportions first for the chosen export size. The six fixed PNG sizes include square, portrait, landscape, and two phone sizes. Pinch a filled slot or use Zoom to adjust its crop. Drag inside the slot to reposition the photo, or drag it onto another slot to swap the two. Select a photo for Replace and Move / swap controls. Switching to a smaller template keeps unused photos in the tray. Use Borders to change the color and thickness of both the frame and the space between photos.

The web prototype reads and processes images in the browser. Reloading clears the current session. Supported formats include PNG, JPEG, WebP, GIF, AVIF, and BMP, subject to browser support. Image and canvas sizes are bounded to protect device memory.

## Run locally

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173.

```sh
node --test tests/*.test.mjs
node --check dist/app.mjs
```

## Android

Pairwise for Android embeds the same editor offline, supports Android 11 and later, and uses the system photo picker. It asks for access to the photos you select. PNG and ZIP exports are saved directly to the shared Downloads folder.

To build a signed APK, install Android SDK Platform 35 and Build Tools 36.0.0, set `ANDROID_SDK_ROOT`, and use JDK 17 or newer. Supply your private PKCS#12 or Java keystore through `PAIRWISE_KEYSTORE` and set `PAIRWISE_SIGNING_PASSWORD` in your environment. Set `PAIRWISE_KEY_ALIAS` if your signing alias differs from `pairwise`.

```sh
./android/build.sh
```

The default output is `android/build/Pairwise.apk`. Android updates for the same package must be signed with the same key.
