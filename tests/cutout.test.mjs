import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCard, removeColor, spotifyShareLink, visibleBounds } from '../dist/cutout-core.mjs';

test('connected color removal preserves an isolated area of the same color', () => {
  const pixels = new Uint8ClampedArray([
    224, 230, 220, 255, 30, 30, 30, 255, 224, 230, 220, 255,
    225, 230, 220, 255, 30, 30, 30, 255, 224, 230, 220, 255,
  ]);
  const options = { color: [224, 230, 220], tolerance: 2, seed: { x: 0, y: 0 } };
  removeColor(pixels, 3, 2, { ...options, connected: true });
  assert.deepEqual([pixels[3], pixels[11], pixels[15], pixels[23]], [0, 255, 0, 255]);
  removeColor(pixels, 3, 2, { ...options, connected: false });
  assert.deepEqual(visibleBounds(pixels, 3, 2), { x: 1, y: 0, width: 1, height: 2 });
  removeColor(pixels, 3, 2, { ...options, color: [30, 30, 30] });
  assert.equal(visibleBounds(pixels, 3, 2), null);
});

test('finds the bounds of a centered story card with a gradient exterior', () => {
  const width = 150, height = 266;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = x >= 22 && x < 128 && y >= 78 && y < 184;
      const tone = Math.round((inside ? 48 : 90) + y / 6);
      pixels.set([tone + 13, tone, tone - 8, 255], (y * width + x) * 4);
    }
  }
  const card = detectCard(pixels, width, height, 'lyrics');
  assert.ok(card);
  for (const [name, expected] of Object.entries({ x: 22, y: 78, width: 106, height: 106 })) {
    assert.ok(Math.abs(card[name] - expected) <= 4, `${name} was ${card[name]}`);
  }
});

test('only supported Spotify track and short links are extracted', () => {
  const track = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
  assert.equal(spotifyShareLink(`Try ${track}?si=tracking`), track);
  assert.equal(spotifyShareLink('https://spotify.link/abc-DEF_123'), 'https://spotify.link/abc-DEF_123');
  assert.equal(spotifyShareLink('https://open.spotify.com.attacker.test/track/4cOdK2wGLETKBW3PvgPWqT'), '');
});

test('Auto keeps the outer card when its square cover has stronger edges', () => {
  const width = 150, height = 266;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frame = x >= 25 && x < 125 && y >= 57 && y < 209;
      const cover = x >= 30 && x < 120 && y >= 62 && y < 152;
      const tone = cover ? 210 : frame ? 45 : 73;
      pixels.set([tone, tone, tone, 255], (y * width + x) * 4);
    }
  }
  const card = detectCard(pixels, width, height);
  assert.deepEqual(card, detectCard(pixels, width, height, 'song'));
  assert.ok(Math.abs(card.height - 152) <= 6, JSON.stringify(card));
});

test('extracts playlist links without tracking or collaboration parameters', () => {
  const playlist = 'https://open.spotify.com/intl-pt/playlist/2wuic8rJIJeD8CxedTzVMK';
  assert.equal(spotifyShareLink(`My playlist: ${playlist}?si=a&pt=b`), playlist);
});
