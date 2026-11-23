import { encodePng } from './photos.mjs';

function pickPalette(art) {
  const sample = document.createElement('canvas');
  sample.width = sample.height = 20;
  const ctx = sample.getContext('2d');
  ctx.drawImage(art, 0, 0, 20, 20);
  const { data } = ctx.getImageData(0, 0, 20, 20);
  const colors = [0, 0, 0];
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const channels = [data[i], data[i + 1], data[i + 2]];
    const weight = 32 + Math.max(...channels) - Math.min(...channels);
    channels.forEach((channel, index) => { colors[index] += channel * weight; });
    total += weight;
  }
  const mix = (factor, base) => `rgb(${colors.map((channel, i) => Math.round(base[i] + factor * channel / (total || 1))).join(' ')})`;
  return { background: mix(.25, [28, 26, 33]), accent: mix(.57, [92, 88, 94]) };
}

function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  const chars = Array.from(text);
  while (chars.length && ctx.measureText(`${chars.join('')}…`).width > width) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

function wrapLines(ctx, text, width) {
  const lines = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawArt(ctx, art, x, y, size) {
  const scale = size / Math.max(art.naturalWidth, art.naturalHeight);
  const width = art.naturalWidth * scale, height = art.naturalHeight * scale;
  x += (size - width) / 2;
  y += (size - height) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, Math.min(16, width / 2, height / 2));
  ctx.clip();
  ctx.drawImage(art, x, y, width, height);
  ctx.restore();
}

export async function createShareCard(artBlob, { title, subtitle, layout, entries, kind }) {
  const art = new Image();
  const logo = new Image();
  const url = URL.createObjectURL(artBlob);
  art.src = url;
  logo.src = './spotify-wordmark.png';
  try {
    await Promise.all([art.decode(), logo.decode()]);
  } finally {
    URL.revokeObjectURL(url);
  }

  const canvas = document.createElement('canvas');
  canvas.width = 720;
  const ctx = canvas.getContext('2d');
  const cover = layout === 'cover';
  const lyrics = layout === 'lyrics';
  const titleFont = `700 ${cover ? 43 : 36}px system-ui`;
  const titleWidth = cover ? 624 : 474;
  ctx.font = titleFont;
  const titleLines = wrapLines(ctx, title, titleWidth);
  const titleCount = Math.min(titleLines.length, 3);
  ctx.font = '650 43px system-ui';
  const verses = lyrics ? entries.map(line => wrapLines(ctx, line, 604)) : [];
  const verseHeight = verses.reduce((sum, line) => sum + line.length * 52 + 9, 0);
  const headerHeight = Math.max(122, titleCount * 42 + 42);
  const bodyStart = 52 + headerHeight + 34;
  canvas.height = cover ? 770 + titleCount * 49
    : bodyStart + (lyrics ? Math.max(100, verseHeight) : Math.max(70, entries.length * 75)) + 100;

  const { background, accent } = pickPalette(art);
  const gradient = ctx.createLinearGradient(0, 0, 580, canvas.height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, '#101116');
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 32);
  ctx.clip();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 10);
  ctx.textBaseline = 'top';

  const x = cover ? 48 : 198;
  const y = cover ? 660 : 52;
  drawArt(ctx, art, 48, cover ? 42 : 48, cover ? 590 : 118);
  ctx.font = titleFont;
  ctx.fillStyle = '#fff';
  titleLines.slice(0, titleCount).forEach((line, index) => {
    const truncated = index === titleCount - 1 && titleLines.length > titleCount;
    ctx.fillText(fitText(ctx, truncated ? `${line}…` : line, titleWidth), x, y + index * (cover ? 49 : 42));
  });

  const attribution = kind === 'playlist' && subtitle ? `Playlist by ${subtitle}` : subtitle || (kind === 'playlist' ? 'Playlist' : lyrics ? 'Song' : '');
  ctx.font = '500 26px system-ui';
  ctx.fillStyle = '#dfdce5';
  if (attribution) ctx.fillText(fitText(ctx, attribution, titleWidth), x, y + titleCount * (cover ? 49 : 42));

  if (!cover) {
    ctx.fillStyle = accent;
    ctx.fillRect(48, bodyStart - 18, 62, 3);
    if (lyrics) {
      let baseline = bodyStart;
      ctx.font = '650 43px system-ui';
      ctx.fillStyle = '#fff';
      for (const verse of verses) {
        for (const line of verse) {
          ctx.fillText(fitText(ctx, line, 604), 48, baseline);
          baseline += 52;
        }
        baseline += 9;
      }
    } else {
      entries.forEach((entry, index) => {
        const [name, ...artist] = entry.split(/\s+[—–-]\s+/);
        const top = bodyStart + index * 75;
        ctx.font = '600 22px system-ui';
        ctx.fillStyle = accent;
        ctx.fillText(String(index + 1).padStart(2, '0'), 48, top + 5);
        ctx.font = '600 30px system-ui';
        ctx.fillStyle = '#fff';
        ctx.fillText(fitText(ctx, name, 566), 105, top);
        if (artist.length) {
          ctx.font = '24px system-ui';
          ctx.fillStyle = '#dfdce5';
          ctx.fillText(fitText(ctx, artist.join(' — '), 566), 105, top + 35);
        }
      });
    }
  }
  const logoWidth = 105;
  const logoHeight = logoWidth * logo.naturalHeight / logo.naturalWidth;
  ctx.drawImage(logo, canvas.width - 48 - logoWidth, canvas.height - 30 - logoHeight, logoWidth, logoHeight);
  return encodePng(canvas);
}
