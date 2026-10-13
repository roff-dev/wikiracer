// Loads the CSR graph that graph.mjs writes (out/in adjacency, titles, flags, lengths).
import { closeSync, existsSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join } from 'node:path';

export function readTyped(dir, name, Type) {
  const fd = openSync(join(dir, name), 'r');
  const size = fstatSync(fd).size;
  const arr = new Type(size / Type.BYTES_PER_ELEMENT);
  const buf = Buffer.from(arr.buffer);
  for (let o = 0; o < size; o += 1 << 28) readSync(fd, buf, o, Math.min(1 << 28, size - o), o);
  closeSync(fd);
  return arr;
}

// The newest finished pipeline/work/<prefix>-<run>/ (one with meta.json), or throws.
export function newestWorkDir(work, prefix) {
  const dirs = existsSync(work)
    ? readdirSync(work).filter((d) => new RegExp(`^${prefix}-\\d{8}$`).test(d) && existsSync(join(work, d, 'meta.json'))).sort()
    : [];
  if (!dirs.length) throw new Error(`No finished pipeline/work/${prefix}-<run>/`);
  return join(work, dirs.at(-1));
}

export function loadGraph(dir) {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  return {
    meta,
    N: meta.N,
    outOff: readTyped(dir, 'out.off', Uint32Array),
    out: readTyped(dir, 'out.adj', Int32Array),
    inOff: readTyped(dir, 'in.off', Uint32Array),
    inAdj: readTyped(dir, 'in.adj', Int32Array),
    flags: readTyped(dir, 'flags.bin', Uint8Array),
    len: readTyped(dir, 'len.bin', Int32Array),
    titles: readFileSync(join(dir, 'titles.bin')),
    titleOff: readTyped(dir, 'titles.off', Uint32Array),
  };
}
