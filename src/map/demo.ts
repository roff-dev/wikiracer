// The home page's demo: a recorded search (demo.json, written by pipeline/pools.mjs) for a pair
// that's never a daily, pool or classic course, decoded into the batches, DAG and route the
// reveal plays. Nothing here reads the map.
import type { Dag } from '../search/protocol.ts';
import type { LevelBatch } from './playback.ts';

interface DemoFile {
  start: string;
  finish: string;
  d: number;
  route: string[];
  routeIds: number[];
  nodes: Record<'id' | 'side' | 'depth' | 'angle' | 'parentAngle' | 'flags', string>;
}

export interface Demo {
  start: string;
  finish: string;
  d: number;
  route: string[];
  routeIds: number[];
  batches: LevelBatch[];
  dag: Dag;
}

function bytes(s: string): ArrayBuffer {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}

export function decodeDemo(f: DemoFile): Demo {
  const ids = new Int32Array(bytes(f.nodes.id));
  const side = new Uint8Array(bytes(f.nodes.side));
  const depth = new Uint8Array(bytes(f.nodes.depth));
  const angle = new Float32Array(bytes(f.nodes.angle));
  const parent = new Float32Array(bytes(f.nodes.parentAngle));
  const flags = new Uint8Array(bytes(f.nodes.flags));
  // runs of the same (side, depth) are the levels, in the order the search found them
  const batches: LevelBatch[] = [];
  for (let i = 0; i < ids.length; ) {
    let j = i;
    while (j < ids.length && side[j] === side[i] && depth[j] === depth[i]) j++;
    batches.push({ side: side[i] as 0 | 1, depth: depth[i]!, ids: ids.slice(i, j), angles: angle.slice(i, j), parentAngles: parent.slice(i, j) });
    i = j;
  }
  // flag 1: on a shortest route, flag 2: where the fronts met
  const dagIds = ids.filter((_, k) => (flags[k]! & 1) !== 0);
  const meeting = ids.filter((_, k) => (flags[k]! & 2) !== 0);
  const dag: Dag = { ids: dagIds, meeting, pos: new Uint8Array(dagIds.length), through: new Float64Array(dagIds.length), edges: new Int32Array(0) };
  return { start: f.start, finish: f.finish, d: f.d, route: f.route, routeIds: f.routeIds, batches, dag };
}

export async function loadDemo(): Promise<Demo> {
  const r = await fetch('/demo.json');
  if (!r.ok) throw new Error(`demo.json ${r.status}`);
  return decodeDemo((await r.json()) as DemoFile);
}
