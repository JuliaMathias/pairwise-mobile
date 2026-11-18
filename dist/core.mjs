/** Pure ordering, layout, and ZIP encoding; no network or UI state. */
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function sortByFilename(files) {
  return [...files].sort((first, second) => collator.compare(first.name, second.name));
}

export function groupInOrder(files, count = 2) {
  if (!Number.isInteger(count) || count < 2) throw new Error('Choose a whole number of at least 2 images per group.');
  return Array.from({ length: Math.ceil(files.length / count) }, (_, index) => files.slice(index * count, (index + 1) * count));
}

export function sortedGroups(files, count = 2) {
  return groupInOrder(sortByFilename(files), count);
}

export function moveImage(files, from, to) {
  const reordered = [...files];
  const [image] = reordered.splice(from, 1);
  reordered.splice(to, 0, image);
  return reordered;
}

/** Plan from the retained pixels of each source, with no upscaling. */
export function composition(images, direction) {
  const regions = images.map(image => image.crop ?? { x: 0, y: 0, width: image.width, height: image.height });
  return { ...layout(regions, direction), regions };
}

/** Preserve original pixels; center smaller images along the shared axis. */
export function layout(images,direction) {
  const vertical=direction==='vertical';
  const cross=Math.max(...images.map(i=>vertical?i.width:i.height));
  let offset=0;
  const positions=images.map(image=>{const position=vertical?[Math.floor((cross-image.width)/2),offset]:[offset,Math.floor((cross-image.height)/2)];offset+=vertical?image.height:image.width;return position;});
  return {width:vertical?cross:offset,height:vertical?offset:cross,positions};
}
/** CRC-32 used by ZIP readers to verify each stored file. */
export function crc32(bytes) { let crc = 0xffffffff; for(const byte of bytes) {crc ^= byte; for(let i=0;i<8;i++) crc=(crc>>>1)^((crc&1)?0xedb88320:0);} return (crc^0xffffffff)>>>0; }
/** Encode browser-local time in ZIP's DOS fields (1980–2107, two-second precision).
 * See PKWARE APPNOTE 4.4.6: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 * Clamp out-of-range device clocks instead of wrapping the seven-bit year.
 */
export function zipDateTime(date) {
  if (!Number.isFinite(date.getTime())) throw new Error('Cannot create a ZIP with an invalid date.');
  const bounded = date.getFullYear() < 1980 ? new Date(1980, 0, 1)
    : date.getFullYear() > 2107 ? new Date(2107, 11, 31, 23, 59, 58) : date;
  return {
    date: ((bounded.getFullYear() - 1980) << 9) | ((bounded.getMonth() + 1) << 5) | bounded.getDate(),
    time: (bounded.getHours() << 11) | (bounded.getMinutes() << 5) | Math.floor(bounded.getSeconds() / 2),
  };
}

/** Use one download-time timestamp for every entry; date injection keeps tests deterministic. */
export async function makeZip(files, downloadedAt = new Date()) {
  const timestamp = zipDateTime(downloadedAt);
  const parts=[], directory=[]; let offset=0, size=0;
  const record=(length)=>{const bytes=new Uint8Array(length);return [bytes,new DataView(bytes.buffer)];};
  for(const file of files) {
    const name=new TextEncoder().encode(file.name), bytes=new Uint8Array(await file.blob.arrayBuffer());
    if(bytes.length>0xffffffff || offset+bytes.length>0xffffffff || files.length>65535) throw new Error('This bundle exceeds the ZIP size limit. Download images individually.');
    const crc=crc32(bytes), [local,l]=record(30); l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x800,true);l.setUint16(10,timestamp.time,true);l.setUint16(12,timestamp.date,true);l.setUint32(14,crc,true);l.setUint32(18,bytes.length,true);l.setUint32(22,bytes.length,true);l.setUint16(26,name.length,true);
    parts.push(local,name,bytes);
    const [central,c]=record(46); c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(12,timestamp.time,true);c.setUint16(14,timestamp.date,true);c.setUint32(16,crc,true);c.setUint32(20,bytes.length,true);c.setUint32(24,bytes.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);
    directory.push(central,name);size+=46+name.length;offset+=30+name.length+bytes.length;
  }
  const [end,e]=record(22);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,size,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...directory,end],{type:'application/zip'});
}

/** Make a portable download prefix without accepting paths or hidden filenames. */
export function safePrefix(value) {
  const cleaned = value.normalize('NFC').trim()
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '-')
    .replace(/^[. ]+|[. ]+$/g, '');
  const shortened = Array.from(cleaned).slice(0, 80).join('').replace(/[. ]+$/g, '');
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(shortened)
    ? `_${shortened}` : shortened;
}

/** Offset is added to one-based group numbering; zero preserves current numbering. */
export function validOffset(value) {
  return Number.isInteger(value) && value >= 0 && value <= 999999999;
}

/** Keep legacy names when the optional prefix is empty. */
export function outputFilename(prefix, index, offset, direction) {
  if (!validOffset(offset)) throw new Error('Choose a whole-number offset from 0 to 999999999.');
  const number = String(index + 1 + offset).padStart(3, '0');
  const name = safePrefix(prefix);
  return name ? `${name}-${number}.png` : `group-${number}-${direction}.png`;
}
