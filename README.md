# Pairwise Mobile

Pairwise is a phone-first prototype for joining images and making collages. Both tools run entirely on-device and appear in the mode picker.

## Join images

Use the sample images or select your own, choose a layout and group size, then save each joined PNG or download all outputs in a ZIP.

Pairwise starts in natural filename order. Drag an image by its grip or use the arrow buttons to reorder it across groups, and use **Sort by name** to restore filename order. Use **Crop** on any image to choose a freeform or fixed-ratio region. **Reset crop** restores the full image when applied.

The **Live preview** shows each group's exact layout and output dimensions as you crop, reorder, or change the join direction. Join preserves cropped pixels with transparent padding or a solid background, or scales each image proportionally to the widest image in a stack or the tallest image in a row. An optional colored border frames and separates the images. Exports include the final partial group. Use **File naming** for an optional prefix and number offset.

## Make a collage

Import several photos to start with a grid sized for the selection, or choose a template and tap each empty slot to import one photo. Collages support 2–9 slots and six fixed PNG sizes, including square, portrait, landscape, and two phone sizes. Tap any filled slot to zoom, reposition, replace, or move its photo into another slot. Switching to a smaller template keeps unused photos in the tray. Use Borders to change the color and thickness of both the frame and the space between photos.

The prototype reads and processes images in the browser. Reloading clears the current session. Supported formats include PNG, JPEG, WebP, GIF, AVIF, and BMP, subject to browser support. Image and canvas sizes are bounded to protect device memory.

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
