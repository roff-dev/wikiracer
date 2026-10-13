// BFS renumbering: roots by in-degree (desc, ties by graph id), each
// component breadth-first over out-links then in-links in CSR order. Returns rank: graph id → map id.
export function bfsRank({ N, outOff, out, inOff, inAdj }) {
  if (N >= 2 ** 23) throw new Error('N past 2^23: widen the degree sort key');
  const rank = new Int32Array(N).fill(-1);
  // key = (2^22 - in-degree) * 2^23 + id stays below 2^45, exact in a float64
  const byDeg = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const d = inOff[i + 1] - inOff[i];
    if (d >= 2 ** 22) throw new Error('in-degree past 2^22: widen the degree sort key');
    byDeg[i] = (2 ** 22 - d) * 2 ** 23 + i;
  }
  byDeg.sort();
  const queue = new Int32Array(N);
  let next = 0, head = 0, tail = 0;
  for (let r = 0; r < N; r++) {
    const root = byDeg[r] % 2 ** 23; // the low 23 bits hold the id
    if (rank[root] >= 0) continue;
    rank[root] = next++; queue[tail++] = root;
    while (head < tail) {
      const u = queue[head++];
      for (let k = outOff[u]; k < outOff[u + 1]; k++) { const v = out[k]; if (rank[v] < 0) { rank[v] = next++; queue[tail++] = v; } }
      for (let k = inOff[u]; k < inOff[u + 1]; k++) { const v = inAdj[k]; if (rank[v] < 0) { rank[v] = next++; queue[tail++] = v; } }
    }
  }
  if (next !== N) throw new Error(`BFS numbered ${next} of ${N}`);
  return rank;
}
