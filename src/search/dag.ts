// Views of the shortest-route DAG for the result panel: columns
// by distance, the articles on routes through one chosen article, and another route that avoids
// a link that's gone from today's Wikipedia.
import type { Dag } from './protocol.ts';

export interface Column {
  // node indexes into dag.ids, most routes first, then by id
  nodes: number[];
}

export function columns(dag: Dag): Column[] {
  const depth = Math.max(0, ...dag.pos);
  const cols: Column[] = Array.from({ length: depth + 1 }, () => ({ nodes: [] }));
  for (let i = 0; i < dag.ids.length; i++) cols[dag.pos[i]!]!.nodes.push(i);
  for (const c of cols) c.nodes.sort((a, b) => dag.through[b]! - dag.through[a]! || dag.ids[a]! - dag.ids[b]!);
  return cols;
}

function adjacency(dag: Dag) {
  const succ: number[][] = Array.from({ length: dag.ids.length }, () => []);
  const pred: number[][] = Array.from({ length: dag.ids.length }, () => []);
  for (let e = 0; e < dag.edges.length; e += 2) {
    succ[dag.edges[e]!]!.push(dag.edges[e + 1]!);
    pred[dag.edges[e + 1]!]!.push(dag.edges[e]!);
  }
  return { succ, pred };
}

// The node indexes on at least one shortest route through node `via`
export function throughNode(dag: Dag, via: number): Set<number> {
  const { succ, pred } = adjacency(dag);
  const out = new Set<number>([via]);
  for (const next of [succ, pred]) {
    const stack = [via];
    while (stack.length) for (const j of next[stack.pop()!]!) if (!out.has(j)) (out.add(j), stack.push(j));
  }
  return out;
}

// Routes through `via`: the product of the routes reaching
// it from the start and leaving it for the finish is dag.through[via] already.
export const routesThrough = (dag: Dag, via: number) => dag.through[via]!;

// A shortest route from start to finish (map ids) that uses none of the `avoid` links (pairs of
// map ids), preferring the most travelled step as the featured route does; null if none.
export function routeAvoiding(dag: Dag, from: number, to: number, avoid: [number, number][]): number[] | null {
  const { succ } = adjacency(dag);
  const banned = new Set(avoid.map(([a, b]) => `${a}>${b}`));
  const start = dag.ids.indexOf(from);
  if (start < 0) return null;
  const dead = new Set<number>();
  const walk = (i: number): number[] | null => {
    if (dag.ids[i] === to) return [to];
    if (dead.has(i)) return null;
    const next = succ[i]!.filter((j) => !banned.has(`${dag.ids[i]}>${dag.ids[j]}`)).sort((a, b) => dag.through[b]! - dag.through[a]! || dag.ids[a]! - dag.ids[b]!);
    for (const j of next) {
      const rest = walk(j);
      if (rest) return [dag.ids[i]!, ...rest];
    }
    dead.add(i);
    return null;
  };
  return walk(start);
}

// For building one route a step at a time: each node's next steps (most routes onward first,
// then by id) and how many shortest routes run from it to the finish
export function stepper(dag: Dag): { next: number[][]; onward: Float64Array } {
  const { succ } = adjacency(dag);
  const onward = new Float64Array(dag.ids.length);
  const order = [...dag.ids.keys()].sort((a, b) => dag.pos[b]! - dag.pos[a]!);
  const depth = Math.max(0, ...dag.pos);
  for (const i of order) onward[i] = dag.pos[i] === depth ? 1 : succ[i]!.reduce((s, j) => s + onward[j]!, 0);
  for (const list of succ) list.sort((a, b) => onward[b]! - onward[a]! || dag.ids[a]! - dag.ids[b]!);
  return { next: succ, onward };
}
