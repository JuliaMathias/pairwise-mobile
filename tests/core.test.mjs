import test from 'node:test';
import assert from 'node:assert/strict';
import {sortedGroups,layout,crc32,makeZip,outputFilename,safePrefix,validOffset,zipDateTime} from '../dist/core.mjs';
test('natural ordering, stable duplicates, and incomplete last groups',()=>{const names=['img10.png','img2.png','img1.png','img3.png','img4.png'];const files=names.map(name=>({name}));assert.deepEqual(sortedGroups(files,3).map(group=>group.map(i=>i.name)),[['img1.png','img2.png','img3.png'],['img4.png','img10.png']]);assert.equal(files[0].name,'img10.png');const a={name:'a'},b={name:'A'};assert.deepEqual(sortedGroups([a,b],2),[[a,b]]);assert.deepEqual(sortedGroups([],2),[]);});
test('reject invalid group sizes',()=>{for(const n of [0,1,2.5,NaN])assert.throws(()=>sortedGroups([],n));});
test('vertical and horizontal layouts retain all dimensions and center',()=>{const images=[{width:20,height:10},{width:10,height:30},{width:40,height:20}];assert.deepEqual(layout(images,'vertical'),{width:40,height:60,positions:[[10,0],[15,10],[0,40]]});assert.deepEqual(layout(images,'horizontal'),{width:70,height:30,positions:[[0,10],[20,0],[30,5]]});assert.deepEqual(layout([images[0]],'vertical'),{width:20,height:10,positions:[[0,0]]});});
test('odd differences align on whole pixels to avoid blur',()=>assert.deepEqual(layout([{width:15,height:15},{width:20,height:10}],'vertical').positions,[[2,0],[0,15]]));
test('CRC32 matches known vector',()=>assert.equal(crc32(new TextEncoder().encode('123456789')),0xcbf43926));
test('ZIP includes valid signatures, offsets and UTF8 files',async()=>{const files=[{name:'group-001.png',blob:new Blob(['one'])},{name:'á.png',blob:new Blob(['two'])}];const zip=await makeZip(files),bytes=new Uint8Array(await zip.arrayBuffer()),view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034b50);const end=bytes.length-22;assert.equal(view.getUint32(end,true),0x06054b50);assert.equal(view.getUint16(end+10,true),2);const offset=view.getUint32(end+16,true);assert.equal(view.getUint32(offset,true),0x02014b50);assert.equal(view.getUint32(offset+16,true),crc32(new TextEncoder().encode('one')));});

test('custom output prefix and offset work across group boundaries', () => {
  assert.equal(outputFilename('Holiday', 0, 10, 'vertical'), 'Holiday-011.png');
  assert.equal(outputFilename('Holiday', 1, 10, 'horizontal'), 'Holiday-012.png');
  assert.equal(outputFilename('Holiday', 2, 998, 'vertical'), 'Holiday-1001.png');
  assert.equal(outputFilename('', 0, 0, 'vertical'), 'group-001-vertical.png');
  assert.equal(outputFilename('  ', 1, 10, 'horizontal'), 'group-012-horizontal.png');
});
test('names are portable, bounded and preserve Unicode', () => {
  assert.equal(safePrefix('  Férias 2026  '), 'Férias 2026');
  assert.equal(safePrefix('../Holiday: part/1?'), '-Holiday- part-1-');
  assert.equal(safePrefix('...'), '');
  assert.equal(safePrefix('CON'), '_CON');
  assert.equal(safePrefix('nul.txt'), '_nul.txt');
  assert.equal(safePrefix('a'.repeat(90)), 'a'.repeat(80));
  assert.equal(safePrefix('a\u0000b'), 'a-b');
});
test('offset validates boundaries and rejects invalid values', () => {
  for (const value of [0, 10, 999999999]) assert.equal(validOffset(value), true);
  for (const value of [-1, 1.2, NaN, Infinity, 1000000000]) {
    assert.equal(validOffset(value), false);
    assert.throws(() => outputFilename('Holiday', 0, value, 'vertical'));
  }
});


test('ZIP timestamps match download time in every local and central header', async () => {
  const downloadedAt = new Date(2026, 10, 4, 18, 18, 49);
  const expectedDate = ((2026 - 1980) << 9) | (11 << 5) | 4;
  const expectedTime = (18 << 11) | (18 << 5) | 24;
  const files = [{name:'one.png',blob:new Blob(['one'])}, {name:'two.png',blob:new Blob(['two'])}];
  const bytes = new Uint8Array(await (await makeZip(files, downloadedAt)).arrayBuffer());
  const view = new DataView(bytes.buffer);
  let local = 0;
  let central = view.getUint32(bytes.length - 6, true);
  for (const file of files) {
    assert.equal(view.getUint32(local, true), 0x04034b50);
    assert.equal(view.getUint16(local + 10, true), expectedTime);
    assert.equal(view.getUint16(local + 12, true), expectedDate);
    assert.equal(view.getUint32(central, true), 0x02014b50);
    assert.equal(view.getUint16(central + 12, true), expectedTime);
    assert.equal(view.getUint16(central + 14, true), expectedDate);
    assert.equal(view.getUint32(central + 42, true), local);
    local += 30 + new TextEncoder().encode(file.name).length + file.blob.size;
    central += 46 + new TextEncoder().encode(file.name).length;
  }
});

test('ZIP date range is clamped and invalid dates are rejected', async () => {
  assert.deepEqual(zipDateTime(new Date(1970, 0, 1)), {date:33,time:0});
  assert.deepEqual(zipDateTime(new Date(2200, 0, 1)), {
    date:(127 << 9) | (12 << 5) | 31,
    time:(23 << 11) | (59 << 5) | 29,
  });
  assert.throws(() => zipDateTime(new Date(NaN)), /invalid date/);
  await assert.rejects(makeZip([], new Date(NaN)), /invalid date/);
});
