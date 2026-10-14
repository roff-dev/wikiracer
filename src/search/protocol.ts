// Messages between the page and the search worker. Every message
// carries the id it answers; the page drops any whose id is stale.

export type Side = 0 | 1; // 0: forward from the start, 1: backward from the finish

export interface TitleHit {
  title: string;
  id: number;
}

// The shortest-route DAG. Node i is ids[i] at distance pos[i] from the start, with
// through[i] shortest routes passing through it; edges are pairs of node indexes (from, to);
// meeting holds the ids where the two fronts met.
export interface Dag {
  ids: Int32Array;
  meeting: Int32Array;
  pos: Uint8Array;
  through: Float64Array;
  edges: Int32Array;
}

export type ToWorker =
  | { kind: 'search'; searchId: number; from: number; to: number; budgetBytes: number; drawBudget: number }
  | { kind: 'continue'; searchId: number; budgetBytes: number }
  | { kind: 'cancel'; searchId: number }
  | { kind: 'lookup'; reqId: number; titles: string[] }
  | { kind: 'prefix'; reqId: number; q: string }
  | { kind: 'titles'; reqId: number; ids: number[] }
  | { kind: 'check'; reqId: number; routes: string[][] }
  | { kind: 'degrees'; reqId: number; id: number };

// 'tooBig': the hard byte cap was reached; the other reasons are the result page's map states.
export type SearchErrorReason = 'network' | 'maintenance' | 'unavailable' | 'tooBig';

export type FromWorker =
  | { kind: 'nodes'; searchId: number; side: Side; depth: number; ids: Int32Array; angles: Float32Array; parentAngles: Float32Array }
  | { kind: 'progress'; searchId: number; explored: number; fetchedBytes: number }
  | {
      kind: 'done';
      searchId: number;
      // null when no route exists
      distance: number | null;
      pathCount: number;
      explored: number;
      fetchedBytes: number;
      dag: Dag | null;
      featured: number[] | null;
    }
  | { kind: 'cancelled'; searchId: number }
  | { kind: 'budget'; searchId: number; fetchedBytes: number }
  | { kind: 'error'; searchId: number; reason: SearchErrorReason }
  | { kind: 'lookupResult'; reqId: number; results: (TitleHit | null)[] }
  | { kind: 'prefixResult'; reqId: number; results: TitleHit[] }
  | { kind: 'titlesResult'; reqId: number; titles: string[] }
  // per route, the indexes of hops (route[i] → route[i + 1]) that aren't in the map
  | { kind: 'checkResult'; reqId: number; missing: number[][] }
  // how many links leave the article and how many reach it
  | { kind: 'degreesResult'; reqId: number; out: number; in: number }
  | { kind: 'requestError'; reqId: number; reason: Exclude<SearchErrorReason, 'tooBig'> };
