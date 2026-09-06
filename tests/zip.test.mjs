import fs from 'node:fs';
import zlib from 'node:zlib';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../assets/js/zip.js', import.meta.url), 'utf8');
new Function(source)();
const zip = globalThis.AR.zip;

/** Builds a real zip archive by hand, so the reader is tested against bytes. */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, 'utf8');
    const plain = Buffer.from(entry.text, 'utf8');
    const stored = entry.stored === true;
    const data = stored ? plain : zlib.deflateRawSync(plain);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(stored ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(plain.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(stored ? 0 : 8, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(plain.length, 24);
    head.writeUInt16LE(name.length, 28);
    head.writeUInt32LE(offset, 42);
    central.push(head, name);

    offset += 30 + name.length + data.length;
  });

  const body = Buffer.concat(locals);
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, dir, end]);
}

test('lists entries and inflates deflated ones', async () => {
  const archive = makeZip([
    { name: 'ppt/slides/slide1.xml', text: '<a:t>Ohm</a:t>' },
    { name: 'ppt/slides/slide2.xml', text: '<a:t>Kirchhoff</a:t>' },
  ]);
  const read = zip.open(archive);
  assert.deepEqual(read.names, ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml']);
  assert.equal(read.has('ppt/slides/slide2.xml'), true);
  assert.equal(read.has('ppt/slides/slide9.xml'), false);
  assert.equal(await read.text('ppt/slides/slide1.xml'), '<a:t>Ohm</a:t>');
  assert.equal(await read.text('ppt/slides/slide2.xml'), '<a:t>Kirchhoff</a:t>');
});

test('reads uncompressed entries and long text', async () => {
  const long = 'voltage divider '.repeat(400);
  const archive = makeZip([
    { name: 'word/document.xml', text: long },
    { name: 'flat.txt', text: 'stored as is', stored: true },
  ]);
  const read = zip.open(archive);
  assert.equal(await read.text('word/document.xml'), long);
  assert.equal(await read.text('flat.txt'), 'stored as is');
  assert.equal(await read.text('missing.xml'), '');
});

test('refuses something that is not a zip', () => {
  assert.throws(() => zip.open(Buffer.from('%PDF-1.7 not a zip at all')), /not a zip archive/);
});
