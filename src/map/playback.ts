// Birth times for the reveal (spec §3.3 "Streaming", §5.6 "Animation"). Buffered levels are
// re-timed so the fronts spread over about 3 s whatever the network did; a live search staggers
// each level as it arrives at no more than 8,000 nodes a second. Within a level, nodes are born
// in hash order, so the level spreads as a ring rather than sweeping round.
import { fmix32 } from '../search/bfs.ts';

export interface LevelBatch {
  side: 0 | 1;
  depth: number;
  ids: Int32Array;
  angles: Float32Array;
  parentAngles: Float32Array;
}

// Birth times (ms from `start`) for each batch, in batch order. Each level gets a share of
// `totalMs` that grows with the square root of its size, so a 30-node level still reads as a
// step and a 20,000-node level doesn't take the whole reveal.
export function retime(batches: LevelBatch[], start: number, totalMs = 3000): Float32Array[] {
  const weights = batches.map((b) => (b.depth === 0 ? 0 : Math.sqrt(b.ids.length)));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return batches.map((b, i) => {
    const dur = (totalMs * weights[i]!) / sum;
    const births = staggered(b.ids, t, dur);
    t += dur;
    return births;
  });
}

// Live: each batch starts when it arrives (or when the previous one finishes), at most `rate`
// nodes per second.
export class LiveTimer {
  private cursor = 0;

  constructor(private readonly rate = 8000) {}

  next(b: LevelBatch, now: number): Float32Array {
    const start = Math.max(now, this.cursor);
    const dur = b.depth === 0 ? 0 : Math.max(250, (1000 * b.ids.length) / this.rate);
    this.cursor = start + dur;
    return staggered(b.ids, start, dur);
  }
}

function staggered(ids: Int32Array, start: number, dur: number): Float32Array {
  const out = new Float32Array(ids.length);
  for (let i = 0; i < ids.length; i++) out[i] = start + (dur * fmix32((ids[i]! ^ 0x5bd1e995) >>> 0)) / 2 ** 32;
  return out;
}
