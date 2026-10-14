// The search worker: one per page. createHost holds the protocol so tests can
// drive it without a Worker; the bottom of the file binds it to the worker's messages.
import { checkRoutes, forLists, runSearch, SearchState } from './bfs.ts';
import type { FromWorker, ToWorker } from './protocol.ts';
import { ByteMeter, isAbort, MapError, MapReader, TooBigError, type ReaderOptions } from './reader.ts';
import { lookupTitle, prefixSearch } from './titles.ts';

export const HARD_CAP_BYTES = 64 * 1024 * 1024;

export interface HostOptions extends ReaderOptions {
  hardCapBytes?: number;
}

type Post = (msg: FromWorker, transfer?: Transferable[]) => void;

interface Running {
  searchId: number;
  controller: AbortController;
  meter: ByteMeter;
  done: Promise<void>;
}

export function createHost(post: Post, opts: HostOptions) {
  const reader = new MapReader(opts);
  const hardCap = opts.hardCapBytes ?? HARD_CAP_BYTES;
  let state: SearchState | null = null;
  let current: Running | null = null;
  // the previous search's unwinding, so only one search touches `state` at a time
  let last: Promise<void> = Promise.resolve();

  function stop(run: Running) {
    run.controller.abort();
    post({ kind: 'cancelled', searchId: run.searchId });
    if (current === run) current = null;
  }

  async function search(m: Extract<ToWorker, { kind: 'search' }>, run: Running, before: Promise<void>) {
    await before;
    const { signal } = run.controller;
    if (signal.aborted) return;
    const live = () => !signal.aborted;
    try {
      await reader.open();
      state ??= new SearchState(reader.manifest.N);
      const out = await runSearch(state, m, {
        reader,
        ctx: { signal, meter: run.meter },
        onNodes: (side, depth, ids, angles, parentAngles) => {
          if (live()) post({ kind: 'nodes', searchId: m.searchId, side, depth, ids, angles, parentAngles }, [ids.buffer, angles.buffer, parentAngles.buffer]);
        },
        onProgress: (explored) => {
          if (live()) post({ kind: 'progress', searchId: m.searchId, explored, fetchedBytes: run.meter.used });
        },
      });
      if (!live()) return;
      const transfer = out.dag ? [out.dag.ids.buffer, out.dag.meeting.buffer, out.dag.pos.buffer, out.dag.through.buffer, out.dag.edges.buffer] : [];
      post(
        { kind: 'done', searchId: m.searchId, distance: out.distance, pathCount: out.pathCount, explored: out.explored, fetchedBytes: run.meter.used, dag: out.dag, featured: out.featured },
        transfer,
      );
    } catch (e) {
      if (!live() || isAbort(e)) return;
      const reason = e instanceof TooBigError ? 'tooBig' : e instanceof MapError ? e.reason : 'network';
      if (!(e instanceof TooBigError || e instanceof MapError)) console.error(e);
      post({ kind: 'error', searchId: m.searchId, reason });
    } finally {
      state?.reset();
      if (current === run) current = null;
    }
  }

  async function request(reqId: number, work: () => Promise<FromWorker>) {
    try {
      await reader.open();
      post(await work());
    } catch (e) {
      if (!(e instanceof MapError)) console.error(e);
      post({ kind: 'requestError', reqId, reason: e instanceof MapError ? e.reason : 'network' });
    }
  }

  const readBlock = (b: number) => reader.readKeyBlock(b);

  // Returns a promise that settles when the message's work is done (tests await it).
  function handle(m: ToWorker): Promise<void> {
    switch (m.kind) {
      case 'search': {
        if (current) stop(current);
        const controller = new AbortController();
        const run: Running = {
          searchId: m.searchId,
          controller,
          meter: new ByteMeter(m.budgetBytes, hardCap, (used) => {
            if (!controller.signal.aborted) post({ kind: 'budget', searchId: m.searchId, fetchedBytes: used });
          }),
          done: Promise.resolve(),
        };
        current = run;
        run.done = search(m, run, last);
        last = run.done;
        return run.done;
      }
      case 'continue':
        if (current?.searchId === m.searchId) current.meter.raise(m.budgetBytes);
        return Promise.resolve();
      case 'cancel':
        if (current?.searchId === m.searchId) stop(current);
        return Promise.resolve();
      case 'lookup':
        return request(m.reqId, async () => ({
          kind: 'lookupResult',
          reqId: m.reqId,
          results: await Promise.all(m.titles.map((t) => lookupTitle(reader.keys, readBlock, t))),
        }));
      case 'prefix':
        return request(m.reqId, async () => ({ kind: 'prefixResult', reqId: m.reqId, results: await prefixSearch(reader.keys, readBlock, m.q) }));
      case 'titles':
        return request(m.reqId, async () => ({ kind: 'titlesResult', reqId: m.reqId, titles: await reader.titles(m.ids) }));
      case 'check':
        return request(m.reqId, async () => {
          const routes = await Promise.all(m.routes.map((r) => Promise.all(r.map(async (t) => (await lookupTitle(reader.keys, readBlock, t))?.id ?? null))));
          return { kind: 'checkResult', reqId: m.reqId, missing: await checkRoutes(reader, routes, {}) };
        });
      case 'degrees':
        return request(m.reqId, async () => {
          const n = [0, 0];
          await Promise.all(([0, 1] as const).map((side) => forLists(reader, side, [m.id], (_, list) => (n[side] = list.length), {})));
          return { kind: 'degreesResult', reqId: m.reqId, out: n[0]!, in: n[1]! };
        });
    }
  }

  return { handle, reader };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
  const host = createHost((msg, transfer) => scope.postMessage(msg, transfer ?? []), { base: `${scope.location.origin}/` });
  scope.onmessage = (e: MessageEvent<ToWorker>) => {
    void host.handle(e.data);
  };
}
