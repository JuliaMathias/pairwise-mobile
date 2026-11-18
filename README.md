# Pairwise Mobile

A phone-first web prototype for Pairwise Image Joiner. Use the sample images or select your own, choose a layout and group size, then save each joined PNG or download all outputs in a ZIP.

Pairwise starts in natural filename order. Drag an image by its grip or use the arrow buttons to reorder it across groups, and use **Sort by name** to restore filename order. Use **Crop** on any image to choose a freeform or fixed-ratio region. **Reset crop** restores the full image when applied.

The **Live preview** shows each group's exact layout and output dimensions as you crop, reorder, or change the join direction. Export keeps the selected pixels at full resolution, centers images on a transparent background, and includes the final partial group. Use **File naming** for an optional prefix and number offset.

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
