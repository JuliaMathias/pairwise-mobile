import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCard, removeColor, spotifyTrackLink, visibleBounds } from '../dist/cutout-core.mjs';

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
  assert.equal(spotifyTrackLink(`Try ${track}?si=tracking`), track);
  assert.equal(spotifyTrackLink('https://spotify.link/abc-DEF_123'), 'https://spotify.link/abc-DEF_123');
  assert.equal(spotifyTrackLink('https://open.spotify.com.attacker.test/track/4cOdK2wGLETKBW3PvgPWqT'), '');
});
