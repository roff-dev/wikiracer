// Title tables (spec §5.5): id → title from the tid slots, title → id from the sorted tkey blocks.
import { readVarint, type Cursor } from './codec.ts';

const utf8 = new TextDecoder();

// The sort and lookup key. The pipeline computes it with the same JavaScript toLowerCase.
export const titleKey = (title: string): string => title.replaceAll('_', ' ').toLowerCase();

// Typed or pasted input → Wikipedia's underscore form: percent-decoded when it's valid percent
// encoding, spaces to underscores, outer spaces trimmed, first letter upper-cased.
export function normaliseTitle(input: string): string {
  let t = input;
  if (/%[0-9A-Fa-f]{2}/.test(t)) {
    try {
      t = decodeURIComponent(t);
    } catch {
      // not percent encoding after all; keep it as typed
    }
  }
  t = t.replaceAll('_', ' ').trim().replace(/ +/g, '_');
  const first = t.codePointAt(0);
  if (first === undefined) return t;
  const head = String.fromCodePoint(first);
  return head.toUpperCase() + t.slice(head.length);
}

// id → title: decodes `id`'s entry from its group's bytes, where `first` is the group's first id.
export function titleInGroup(group: Uint8Array, first: number, id: number): string {
  const c: Cursor = { bytes: group, pos: 0 };
  for (let k = first; k < id; k++) {
    const len = readVarint(c); // read first: `c.pos += readVarint(c)` would drop the varint's own bytes
    c.pos += len;
  }
  const len = readVarint(c);
  return utf8.decode(group.subarray(c.pos, c.pos + len));
}

// The tkey block index: each block's first key, in block order.
export function decodeKeyIndex(bytes: Uint8Array): string[] {
  const c: Cursor = { bytes, pos: 0 };
  const keys: string[] = [];
  while (c.pos < bytes.length) {
    const len = readVarint(c);
    keys.push(utf8.decode(bytes.subarray(c.pos, c.pos + len)));
    c.pos += len;
  }
  return keys;
}

export interface TitleEntry {
  title: string;
  id: number;
}

// All entries of one tkey block. Entries are front-coded: varint(shared prefix bytes with the
// previous title), varint(suffix length), suffix, varint(id). Zero padding ends the block (no
// title is empty, so an entry with an empty suffix can't occur; a lone padding byte at the end
// also ends it).
export function decodeKeyBlock(block: Uint8Array): TitleEntry[] {
  const c: Cursor = { bytes: block, pos: 0 };
  const out: TitleEntry[] = [];
  let prev = new Uint8Array(0);
  while (c.pos < block.length) {
    const shared = readVarint(c);
    if (c.pos >= block.length) break;
    const suffix = readVarint(c);
    if (suffix === 0) break;
    const t = new Uint8Array(shared + suffix);
    t.set(prev.subarray(0, shared));
    t.set(block.subarray(c.pos, c.pos + suffix), shared);
    c.pos += suffix;
    out.push({ title: utf8.decode(t), id: readVarint(c) });
    prev = t;
  }
  return out;
}

export type ReadBlock = (block: number) => Promise<Uint8Array>;

// Walks entries in key order from the block where `key` can first appear, while `keep` holds.
// A run of equal keys can end one block and start the next, so the walk starts at the last block
// whose first key is strictly below `key` and reads on while matches reach a block's end.
async function* entriesFrom(keys: string[], readBlock: ReadBlock, key: string): AsyncGenerator<TitleEntry & { key: string }> {
  let lo = 0;
  let hi = keys.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (keys[mid]! < key) lo = mid;
    else hi = mid - 1;
  }
  for (let b = lo; b < keys.length; b++) {
    for (const e of decodeKeyBlock(await readBlock(b))) yield { ...e, key: titleKey(e.title) };
  }
}

// Exact lookup: an exact title match wins, a single key match is accepted, otherwise null
// (the caller then asks Wikipedia to resolve redirects and capitalisation, §5.5).
export async function lookupTitle(keys: string[], readBlock: ReadBlock, input: string): Promise<TitleEntry | null> {
  const title = normaliseTitle(input);
  const key = titleKey(title);
  const matches: TitleEntry[] = [];
  for await (const e of entriesFrom(keys, readBlock, key)) {
    if (e.key < key) continue;
    if (e.key !== key) break;
    if (e.title === title) return { title: e.title, id: e.id };
    matches.push({ title: e.title, id: e.id });
  }
  return matches.length === 1 ? matches[0]! : null;
}

// Prefix search: the first `limit` entries whose key starts with the typed key, in key order.
export async function prefixSearch(keys: string[], readBlock: ReadBlock, input: string, limit = 8): Promise<TitleEntry[]> {
  const key = titleKey(normaliseTitle(input));
  const out: TitleEntry[] = [];
  if (!key) return out;
  for await (const e of entriesFrom(keys, readBlock, key)) {
    if (e.key < key) continue;
    if (!e.key.startsWith(key)) break;
    out.push({ title: e.title, id: e.id });
    if (out.length === limit) break;
  }
  return out;
}
