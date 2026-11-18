# Pairwise Mobile

A phone-first web prototype for Pairwise Image Joiner. Use the sample images or select your own, choose a layout and group size, then save each joined PNG or download all outputs in a ZIP.

Pairwise sorts input by filename using natural order. It keeps original pixel dimensions, centers images on a transparent background, and includes the final partial group. Use File naming for an optional prefix and number offset.

The prototype reads and processes images in the browser. Reloading clears the current session. Supported formats include PNG, JPEG, WebP, GIF, AVIF, and BMP, subject to browser support. Image and canvas sizes are bounded to protect device memory.

## Run locally

From the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:4173.

```sh
node --test tests/core.test.mjs
node --check dist/app.mjs
```
