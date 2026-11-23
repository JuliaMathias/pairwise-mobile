export function songLookupTitle(title) {
  return title.replace(/\s*[([](?:feat\.?|ft\.?|featuring)\s[^)\]]+[)\]]\s*/gi, ' ').trim();
}

function comparable(text) {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

export function matchingLyrics(results, { title, artist = '', duration = 0 }) {
  const wantedTitle = comparable(songLookupTitle(title));
  const wantedArtist = comparable(artist);
  const candidates = results.filter(row => row && typeof row.trackName === 'string' &&
    typeof row.artistName === 'string' && typeof row.plainLyrics === 'string' &&
    row.plainLyrics.trim() && !row.instrumental &&
    comparable(songLookupTitle(row.trackName)) === wantedTitle);
  function score(row) {
    const rowArtist = comparable(row.artistName);
    const matchesArtist = wantedArtist && (rowArtist === wantedArtist ||
      row.artistName.split(/[,;&]/).some(name => comparable(name) === wantedArtist));
    return (matchesArtist ? 1000 : 0) + (duration && row.duration ? Math.max(0, 80 - Math.abs(row.duration - duration)) : 0);
  }
  candidates.sort((a, b) => score(b) - score(a));
  const seen = new Set();
  return candidates.filter(row => {
    const key = comparable(row.artistName) + '\n' + row.plainLyrics.trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 12);
}
