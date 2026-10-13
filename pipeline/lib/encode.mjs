// The map encoder (spec §5.4, §5.5): CSR graph → chunk files and index files, then a self-check
// that reads everything back with the browser's own decoders (src/search/*.ts). Used by
// pipeline/encode.mjs on the real graph and by the tests on synthetic graphs.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { ChunkReader, ChunkWriter } from './chunks.mjs';
import { bfsRank } from './renumber.mjs';
import { SlotPacker, slotIndexDeltas } from './slots.mjs';
import { vlen, writeList, writeVarint } from './varint.mjs';
import { readList, readVarint } from '../../src/search/codec.ts';
import { decodeSlotIndex, groupOf } from '../../src/search/layout.ts';
import { decodeKeyBlock, decodeKeyIndex, lookupTitle, titleInGroup, titleKey } from '../../src/search/titles.ts';

export const SLOT = 2048;
export const KEY_BLOCK = 16384;
export const CHUNK = 48 * 1024 * 1024; // 24,576 slots or 3,072 tkey blocks per file

// Encodes graph g into mapDir (which must exist and be empty) and checks it. chunkBytes must be a
// multiple of KEY_BLOCK. lookupTitles are titles that must resolve through the real lookup.
// Returns the report, the index file bytes, the chunk file sizes per table and rank (graph id →
// map id).
export async function encodeMap(g, mapDir, { chunkBytes = CHUNK, log = () => {}, lookupTitles = [] } = {}) {
  if (chunkBytes % KEY_BLOCK) throw new Error('chunkBytes must be a multiple of 16 KB');
  const { N, outOff, out, inOff, inAdj } = g;
  const fail = (msg) => { throw new Error(`self-check: ${msg}`); };
  const rank = bfsRank(g);
  const inv = new Int32Array(N);
  for (let i = 0; i < N; i++) inv[rank[i]] = i;
  log('bfs renumbering');

  // ---------- lists (§5.4 "Lists", "Slots and groups")
  let maxDeg = 0;
  for (let i = 0; i < N; i++) maxDeg = Math.max(maxDeg, outOff[i + 1] - outOff[i], inOff[i + 1] - inOff[i]);
  const scratch = new Int32Array(maxDeg);
  const listBuf = Buffer.alloc(5 * (maxDeg + 1));
  const report = { N, E: g.meta.E };

  function encodeSide(name, off, adj) {
    const writer = new ChunkWriter(mapDir, name, chunkBytes);
    const packer = new SlotPacker(writer, SLOT);
    let listBytes = 0;
    for (let u = 0; u < N; u++) {
      const old = inv[u];
      const d = off[old + 1] - off[old];
      for (let k = 0; k < d; k++) scratch[k] = rank[adj[off[old] + k]];
      const ids = scratch.subarray(0, d).sort();
      const len = writeList(listBuf, 0, ids);
      listBytes += len;
      packer.add(listBuf.subarray(0, len));
    }
    const firstOfSlot = packer.finish();
    const files = writer.finish();
    return { files, firstOfSlot, listBytes };
  }

  // ---------- id → title (§5.5): varint(length) + UTF-8 bytes, in id order, same slots
  function encodeTid() {
    const writer = new ChunkWriter(mapDir, 'tid', chunkBytes);
    const packer = new SlotPacker(writer, SLOT);
    const entry = Buffer.alloc(8 + 4096);
    for (let id = 0; id < N; id++) {
      const o = inv[id];
      const s = g.titleOff[o], e = g.titleOff[o + 1];
      const p = writeVarint(entry, 0, e - s);
      g.titles.copy(entry, p, s, e);
      packer.add(entry.subarray(0, p + e - s));
    }
    return { firstOfSlot: packer.finish(), files: writer.finish() };
  }

  // ---------- title → id (§5.5): sorted by key (ties by id), front-coded in 16 KB blocks
  function encodeTkey() {
    const keys = new Array(N);
    for (let id = 0; id < N; id++) keys[id] = titleKey(g.titles.toString('utf8', g.titleOff[inv[id]], g.titleOff[inv[id] + 1]));
    const order = Int32Array.from({ length: N }, (_, i) => i).sort((a, b) => (keys[a] < keys[b] ? -1 : keys[a] > keys[b] ? 1 : a - b));
    log('sorted titles');
    const writer = new ChunkWriter(mapDir, 'tkey', chunkBytes);
    const firstKeys = [];
    const entry = Buffer.alloc(16 + 4096);
    let cur = 0, prevS = 0, prevE = 0;
    for (const id of order) {
      const s = g.titleOff[inv[id]], e = g.titleOff[inv[id] + 1];
      const tl = e - s;
      let shared = 0;
      if (cur > 0) {
        const m = Math.min(prevE - prevS, tl);
        while (shared < m && g.titles[prevS + shared] === g.titles[s + shared]) shared++;
      }
      let size = vlen(shared) + vlen(tl - shared) + (tl - shared) + vlen(id);
      if (cur === 0 || cur + size > KEY_BLOCK) {
        if (cur > 0) writer.pad(KEY_BLOCK - cur);
        cur = 0; shared = 0;
        size = vlen(0) + vlen(tl) + tl + vlen(id);
        firstKeys.push(keys[id]);
      }
      let p = writeVarint(entry, 0, shared);
      p = writeVarint(entry, p, tl - shared);
      p += g.titles.copy(entry, p, s + shared, e);
      p = writeVarint(entry, p, id);
      writer.write(entry.subarray(0, p));
      cur += size;
      prevS = s; prevE = e;
    }
    writer.pad(KEY_BLOCK - cur);
    return { firstKeys, files: writer.finish(), order, keys };
  }

  const sides = {};
  for (const [name, off, adj] of [['out', outOff, out], ['in', inOff, inAdj]]) {
    sides[name] = encodeSide(name, off, adj);
    log(`${name}: ${sides[name].firstOfSlot.length} slots, ${sides[name].files.length} files, lists ${sides[name].listBytes} B`);
  }
  const tid = encodeTid();
  log(`tid: ${tid.firstOfSlot.length} slots, ${tid.files.length} files`);
  const tkey = encodeTkey();
  log(`tkey: ${tkey.firstKeys.length} blocks, ${tkey.files.length} files`);

  // ---------- index files (§5.4 "Slot index", §5.5)
  const varintBytes = (vals) => {
    const buf = Buffer.alloc(vals.length * 5);
    let p = 0;
    for (const v of vals) p = writeVarint(buf, p, v);
    return buf.subarray(0, p);
  };
  const indexes = {
    out: gzipSync(varintBytes(slotIndexDeltas(sides.out.firstOfSlot)), { level: 9 }),
    in: gzipSync(varintBytes(slotIndexDeltas(sides.in.firstOfSlot)), { level: 9 }),
    tid: gzipSync(varintBytes(slotIndexDeltas(tid.firstOfSlot)), { level: 9 }),
    tkey: gzipSync(Buffer.concat(tkey.firstKeys.flatMap((k) => { const b = Buffer.from(k, 'utf8'); return [varintBytes([b.length]), b]; })), { level: 9 }),
  };
  for (const [k, v] of Object.entries(indexes)) writeFileSync(join(mapDir, `${k}.idx`), v);

  // ---------- self-check: lists, against the CSR arrays in the original ids
  function checkSide(name, off, adj) {
    const index = decodeSlotIndex(gunzipSync(readFileSync(join(mapDir, `${name}.idx`))));
    if (index.length !== sides[name].firstOfSlot.length) fail(`${name}.idx has ${index.length} slots`);
    const reader = new ChunkReader(mapDir, name, chunkBytes);
    let id = 0, maxSlots = 0, groups = 0;
    for (let slot = 0; slot < index.length;) {
      const grp = groupOf(index, id);
      if (grp.slot !== slot || grp.first !== id) fail(`${name}: id ${id} maps to slot ${grp.slot}, expected ${slot}`);
      const bytes = reader.read(slot * SLOT, grp.slots * SLOT);
      const end = slot + grp.slots < index.length ? index[slot + grp.slots] : N;
      const c = { bytes, pos: 0 };
      for (; id < end; id++) {
        if (id > grp.first && groupOf(index, id).slot !== slot) fail(`${name}: id ${id} not found in its group`);
        const got = readList(c);
        const old = inv[id];
        const want = adj.subarray(off[old], off[old + 1]);
        if (got.length !== want.length) fail(`${name}: id ${id} has ${got.length} entries, CSR ${want.length}`);
        for (let k = 0; k < got.length; k++) got[k] = inv[got[k]];
        got.sort();
        for (let k = 0; k < got.length; k++) if (got[k] !== want[k]) fail(`${name}: id ${id} entry ${k}`);
      }
      for (let p = c.pos; p < bytes.length; p++) if (bytes[p] !== 0) fail(`${name}: slot ${slot} padding not zero`);
      maxSlots = Math.max(maxSlots, grp.slots);
      groups++;
      slot += grp.slots;
    }
    reader.close();
    if (id !== N) fail(`${name}: decoded ${id} lists of ${N}`);
    let maxDelta = 0;
    for (let i = 1; i < index.length; i++) maxDelta = Math.max(maxDelta, index[i] - index[i - 1]);
    return { slots: index.length, groups, maxSlots, maxDelta };
  }

  const titleOf = (id) => g.titles.toString('utf8', g.titleOff[inv[id]], g.titleOff[inv[id] + 1]);

  function checkTid() {
    const index = decodeSlotIndex(gunzipSync(readFileSync(join(mapDir, 'tid.idx'))));
    const reader = new ChunkReader(mapDir, 'tid', chunkBytes);
    const dec = new TextDecoder();
    let id = 0;
    for (let slot = 0; slot < index.length;) {
      const grp = groupOf(index, id);
      if (grp.slot !== slot) fail(`tid: id ${id} maps to slot ${grp.slot}, expected ${slot}`);
      const bytes = reader.read(slot * SLOT, grp.slots * SLOT);
      const end = slot + grp.slots < index.length ? index[slot + grp.slots] : N;
      const c = { bytes, pos: 0 };
      for (; id < end; id++) {
        const len = readVarint(c);
        const t = dec.decode(bytes.subarray(c.pos, c.pos + len));
        c.pos += len;
        if (t !== titleOf(id)) fail(`tid: id ${id} reads "${t}"`);
        if (id % 101 === 0 && titleInGroup(bytes, grp.first, id) !== t) fail(`tid: titleInGroup(${id})`);
      }
      slot += grp.slots;
    }
    reader.close();
    if (id !== N) fail(`tid: decoded ${id} titles of ${N}`);
  }

  async function checkTkey() {
    const keys = decodeKeyIndex(gunzipSync(readFileSync(join(mapDir, 'tkey.idx'))));
    if (keys.length !== tkey.firstKeys.length) fail(`tkey.idx has ${keys.length} keys`);
    const reader = new ChunkReader(mapDir, 'tkey', chunkBytes);
    const readBlock = async (b) => reader.read(b * KEY_BLOCK, KEY_BLOCK);
    const seen = new Uint8Array(N);
    let n = 0, prevKey = '', prevId = -1;
    for (let b = 0; b < keys.length; b++) {
      const entries = decodeKeyBlock(await readBlock(b));
      if (!entries.length || titleKey(entries[0].title) !== keys[b]) fail(`tkey: block ${b} first key`);
      for (const { title, id } of entries) {
        const key = titleKey(title);
        if (key < prevKey || (key === prevKey && id <= prevId)) fail(`tkey: order at "${title}"`);
        if (id >= N || seen[id]++) fail(`tkey: id ${id} repeated or out of range`);
        if (title !== titleOf(id)) fail(`tkey: id ${id} is "${title}"`);
        prevKey = key; prevId = id; n++;
      }
    }
    if (n !== N) fail(`tkey: ${n} entries of ${N}`);
    // The real lookup on every 997th id (in key order, so runs of equal keys are included) and the
    // titles the unit tests name.
    const sample = [];
    for (let k = 0; k < N; k += 997) sample.push(tkey.order[k]);
    for (const t of lookupTitles) {
      const r = await lookupTitle(keys, readBlock, t);
      if (!r || titleOf(r.id) !== t) fail(`lookup "${t}" → ${JSON.stringify(r)}`);
    }
    for (const id of sample) {
      const r = await lookupTitle(keys, readBlock, titleOf(id));
      if (!r || r.id !== id) fail(`lookup "${titleOf(id)}" → ${JSON.stringify(r)}, expected ${id}`);
    }
    reader.close();
    return sample.length;
  }

  for (const [name, off, adj] of [['out', outOff, out], ['in', inOff, inAdj]]) {
    report[name] = { listBytes: sides[name].listBytes, ...checkSide(name, off, adj), index: indexes[name].length };
    log(`checked ${name}`, JSON.stringify(report[name]));
  }
  checkTid();
  report.tid = { slots: tid.firstOfSlot.length, bytes: tid.firstOfSlot.length * SLOT, index: indexes.tid.length };
  log('checked tid');
  const looked = await checkTkey();
  report.tkey = { blocks: tkey.firstKeys.length, bytes: tkey.firstKeys.length * KEY_BLOCK, index: indexes.tkey.length, lookups: looked };
  log(`checked tkey (${looked} sampled lookups)`);

  return {
    report,
    indexes,
    rank,
    fileSizes: { out: sides.out.files, in: sides.in.files, tid: tid.files, tkey: tkey.files },
    slots: { out: sides.out.firstOfSlot.length, in: sides.in.firstOfSlot.length, tid: tid.firstOfSlot.length },
    tkeyBlocks: tkey.firstKeys.length,
  };
}

// Places chunk files on sites: each file, in table order, to the least-loaded site. Returns
// { files: { table: [site per chunk] }, load: bytes per site }.
export function placeFiles(fileSizes, siteCount) {
  const load = new Array(siteCount).fill(0);
  const files = {};
  for (const name of ['out', 'in', 'tid', 'tkey']) {
    files[name] = fileSizes[name].map((size) => {
      const s = load.indexOf(Math.min(...load));
      load[s] += size;
      return s;
    });
  }
  return { files, load };
}

// map.json (§5.4)
export function manifest({ run, N, E, chunkBytes = CHUNK, sites, files, slots, tkeyBlocks, indexPath }) {
  return {
    version: run,
    dumpDate: `${run.slice(0, 4)}-${run.slice(4, 6)}-${run.slice(6, 8)}`,
    N,
    E,
    slotBytes: SLOT,
    chunkBytes,
    tkeyBlockBytes: KEY_BLOCK,
    sites,
    files,
    slots,
    tkeyBlocks,
    index: Object.fromEntries(['out', 'in', 'tid', 'tkey'].map((k) => [k, indexPath(k)])),
  };
}
