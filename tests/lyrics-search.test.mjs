import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingLyrics, songLookupTitle } from '../dist/lyrics-search.mjs';

test('ignores featuring credits in lookup titles but retains version names', () => {
  assert.equal(songLookupTitle('Title (Feat. Guest) [Live]'), 'Title [Live]');
  assert.equal(songLookupTitle('Title [ft. Guest]'), 'Title');
});

test('ranks the Spotify artist and nearest duration, and filters unrelated results', () => {
  const song = { trackName: 'Title', plainLyrics: 'Example lyrics', duration: 245 };
  const otherArtist = { ...song, artistName: 'Another artist' };
  const match = { ...song, artistName: 'Primary, Guest' };
  const live = { ...match, duration: 210, plainLyrics: 'Different take' };
  const unrelated = { ...song, trackName: 'Unrelated', artistName: 'Primary' };
  const instrumental = { ...match, instrumental: true };
  assert.deepEqual(matchingLyrics([otherArtist, live, match, match, unrelated, instrumental],
    { title: 'Title (feat. Guest)', artist: 'Primary', duration: 246 }), [match, live, otherArtist]);
});
