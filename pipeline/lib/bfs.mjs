// In-memory bidirectional BFS over the CSR graph with shortest-route counts, for
// measuring pairs (d, k) and recording the demo.
//
// Each step expands one side's whole frontier: the side whose frontier has fewer links to follow.
// If no article had been reached by both sides before the step, every shortest route is longer
// than (forward depth - 1) + backward depth, so the first step that meets gives
// d = forward depth + backward depth, and every meeting article sits at exactly those depths. Each
// shortest route crosses the newly expanded level once, so k = sum of cntF * cntB over the
// meeting articles.
export function makeSearch({ N, outOff, out, inOff, inAdj }) {
  const dep = [new Int32Array(N).fill(-1), new Int32Array(N).fill(-1)];
  const cnt = [new Float64Array(N), new Float64Array(N)];
  const par = [new Int32Array(N), new Int32Array(N)];
  const touched = [[], []];
  const sides = [{ off: outOff, adj: out }, { off: inOff, adj: inAdj }];

  function reset() {
    for (let s = 0; s < 2; s++) {
      for (const v of touched[s]) dep[s][v] = -1;
      touched[s] = [];
    }
  }

  // Returns { d, k, levels, meet, explored }. levels: the expansions in order, each
  // { side (0 forward, 1 backward), depth, nodes }. d is Infinity if t can't be reached.
  // maxExplored stops a search early (d = Infinity, gaveUp = true).
  function search(s, t, { maxExplored = Infinity } = {}) {
    reset();
    const front = [[s], [t]];
    const L = [0, 0];
    for (const [side, root] of [[0, s], [1, t]]) {
      dep[side][root] = 0; cnt[side][root] = 1; par[side][root] = -1; touched[side].push(root);
    }
    const levels = [];
    if (s === t) return { d: 0, k: 1, levels, meet: [s], explored: 1 };
    let explored = 2;
    while (front[0].length && front[1].length) {
      let cost0 = 0, cost1 = 0;
      for (const u of front[0]) cost0 += outOff[u + 1] - outOff[u];
      for (const u of front[1]) cost1 += inOff[u + 1] - inOff[u];
      const side = cost0 <= cost1 ? 0 : 1;
      const other = 1 - side;
      const { off, adj } = sides[side];
      const d = dep[side], c = cnt[side], p = par[side], depth = L[side] + 1;
      const next = [];
      for (const u of front[side]) {
        const cu = c[u];
        for (let k = off[u]; k < off[u + 1]; k++) {
          const v = adj[k];
          if (d[v] < 0) { d[v] = depth; c[v] = cu; p[v] = u; next.push(v); touched[side].push(v); }
          else if (d[v] === depth) c[v] += cu;
        }
      }
      levels.push({ side, depth, nodes: next });
      L[side] = depth;
      front[side] = next;
      explored += next.length;
      const meet = [];
      for (const v of next) if (dep[other][v] >= 0) meet.push(v);
      if (meet.length) {
        let k = 0;
        for (const v of meet) {
          if (dep[other][v] !== L[other]) throw new Error(`BFS invariant: meeting depth ${dep[other][v]} != ${L[other]}`);
          k += cnt[0][v] * cnt[1][v];
        }
        return { d: L[0] + L[1], k, levels, meet, explored };
      }
      if (explored > maxExplored) return { d: Infinity, k: 0, levels, meet: [], explored, gaveUp: true };
    }
    return { d: Infinity, k: 0, levels, meet: [], explored };
  }

  // The articles on shortest routes, after a search that met: Map id → { pos (distance from s),
  // fromS, toT (route counts from s and to t) }. Walks back from the meeting articles level by
  // level on each side, keeping edges into the current set.
  function dag(res, s, t) {
    const nodes = new Map();
    const Lf = res.levels.filter((l) => l.side === 0).length;
    for (const v of res.meet) nodes.set(v, { pos: Lf, fromS: cnt[0][v], toT: cnt[1][v] });
    for (const side of [0, 1]) {
      // frontiers of this side by depth; depth 0 is the root
      const byDepth = [[side === 0 ? s : t]];
      for (const l of res.levels) if (l.side === side) byDepth.push(l.nodes);
      let cur = new Set(res.meet);
      const top = byDepth.length - 1;
      for (let j = top - 1; j >= 0; j--) {
        const keep = new Set();
        for (const u of byDepth[j]) {
          // forward: u → v with v in cur; backward: v → u, i.e. v in u's in-list
          const { off, adj } = sides[side];
          let sum = 0;
          for (let k = off[u]; k < off[u + 1]; k++) {
            const v = adj[k];
            if (cur.has(v)) sum += side === 0 ? nodes.get(v).toT : nodes.get(v).fromS;
          }
          if (sum > 0) {
            keep.add(u);
            const pos = side === 0 ? j : Lf + (top - j);
            nodes.set(u, side === 0 ? { pos, fromS: cnt[0][u], toT: sum } : { pos, fromS: sum, toT: cnt[1][u] });
          }
        }
        cur = keep;
      }
    }
    return nodes;
  }

  // The featured route: from s, step to the DAG successor that carries the most shortest
  // routes (fromS * toT); ties go to the lowest map id.
  function featured(nodes, s, t, rank) {
    const route = [s];
    let u = s;
    while (u !== t) {
      const pu = nodes.get(u).pos;
      let best = -1, bestW = -1;
      for (let k = outOff[u]; k < outOff[u + 1]; k++) {
        const v = out[k];
        const n = nodes.get(v);
        if (!n || n.pos !== pu + 1) continue;
        const w = n.fromS * n.toT;
        if (w > bestW || (w === bestW && rank[v] < rank[best])) { best = v; bestW = w; }
      }
      if (best < 0) throw new Error('featured route: dead end in the DAG');
      route.push(best);
      u = best;
    }
    return route;
  }

  return { search, dag, featured, dep, par };
}
