// The reveal renderer: one WebGL2 context, instanced drawing, animation in the vertex
// shader. Layer 1 is the two fronts (nodes and parent hairlines), layer 2 the shortest-route DAG,
// layer 3 the courses (the shortest route, and the players' routes) with the start and finish
// markers. The frame loop runs only while something moves.
import { fmix32 } from '../search/bfs.ts';
import type { Dag } from '../search/protocol.ts';
import { Camera, type Bounds } from './camera.ts';
import type { LevelBatch } from './playback.ts';
import * as S from './shaders.ts';
import { FrameProbe, lowerTier, saveTier, TIERS, type Tier } from './tiers.ts';

// reveal colours (on --void)
export const REVEAL = {
  void: '#07080F',
  start: '#4FD8A4',
  finish: '#FF74AC',
  shortest: '#FFFFFF',
  players: ['#FFD23F', '#8F8BFF', '#FF74AC', '#4FD8A4'],
};

// Layout: the start and finish centres sit 3.2 rings apart; one ring per click of distance.
const CENTRES: [number, number][] = [
  [-1.6, 0],
  [1.6, 0],
];
const JITTER = 0.28;

// id null: the ring itself, without the article's jitter (a parent known only by its angle)
export function nodePosition(side: 0 | 1, depth: number, angle: number, id: number | null): [number, number] {
  const [cx, cy] = CENTRES[side]!;
  if (depth === 0) return [cx, cy];
  const r = depth + (id === null ? 0 : (fmix32((id ^ 0x27d4eb2f) >>> 0) / 2 ** 32 - 0.5) * 2 * JITTER);
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

const hex = (h: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

const LOC: Record<string, number> = { a_pos: 0, a_a: 0, a_from: 1, a_b: 1, a_birth: 2, a_leg: 2, a_kind: 2, a_style: 3, a_index: 3 };
const FRONT_STRIDE = 6; // pos2 from2 birth style: 24 bytes
const ADD_PER_FRAME = 4000;

// Additive points saturate where a level is dense, so each level's alpha is scaled by its density
// (nodes per unit of ring area; a ring is about 0.56 wide): 1 up to 150 per unit², then by the
// square root. Stored as a 0–31 step in the style float, so an instance stays 24 bytes.
function densityStep(n: number, depth: number): number {
  const density = n / (2 * Math.PI * Math.max(1, depth) * 0.56);
  return Math.round(31 * Math.min(1, Math.sqrt(150 / Math.max(density, 1))));
}

interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

interface Course {
  ids: number[];
  colour: [number, number, number];
  legs: Float32Array; // ax ay bx by leg
  stops: Float32Array; // x y kind index
  positions: [number, number][];
  start: number;
  duration: number;
  vaoLegs: WebGLVertexArrayObject | null;
  vaoStops: WebGLVertexArrayObject | null;
  buffers: WebGLBuffer[];
}

export interface RendererOptions {
  tier: Tier;
  reducedMotion: boolean;
  // WebGL2 is gone for this visit (a second context loss): show the static view
  onFallback?: () => void;
  onTierDrop?: (tier: Tier) => void;
  // after each frame, for DOM labels placed with project()
  onFrame?: () => void;
}

export class MapRenderer {
  static supported(): boolean {
    try {
      return !!document.createElement('canvas').getContext('webgl2');
    } catch {
      return false;
    }
  }

  tier: Tier;
  private gl!: WebGL2RenderingContext;
  private progs!: Record<'node' | 'edge' | 'dagNode' | 'dagEdge' | 'leg' | 'stop', Program>;
  private frontBuf!: WebGLBuffer;
  private frontVao!: WebGLVertexArrayObject;
  private dagNodeVao: WebGLVertexArrayObject | null = null;
  private dagEdgeVao: WebGLVertexArrayObject | null = null;
  private markerVao!: WebGLVertexArrayObject;
  private glBuffers: WebGLBuffer[] = [];

  // CPU-side copies, so a lost context can be rebuilt
  private front: Float32Array;
  private count = 0;
  private uploaded = 0;
  private readonly where = new Map<number, number>(); // map id → front index (first drawn)
  private dagNodes = new Float32Array(0); // x y style
  private dagEdges = new Float32Array(0); // ax ay bx by style
  private markers = new Float32Array([...CENTRES[0]!, 1, -1, ...CENTRES[1]!, 2, -1]);
  private readonly courses: Course[] = [];

  private readonly camera = new Camera();
  private bounds: Bounds = { minX: -2.6, minY: -1.2, maxX: 2.6, maxY: 1.2 };
  private lastBirth = 0;
  private dimStart = Infinity;
  private readonly t0 = performance.now();
  private skew = 0;
  private raf = 0;
  private lastFrame = 0;
  private losses = 0;
  private dead = false;
  private readonly probe: FrameProbe;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly opts: RendererOptions,
  ) {
    this.tier = opts.tier;
    this.front = new Float32Array((this.tier.drawBudget + 4096) * FRONT_STRIDE);
    this.probe = new FrameProbe(() => this.dropTier());
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    this.init();
    this.resizeObserver = new ResizeObserver(() => this.kick());
    this.resizeObserver.observe(canvas);
    this.camera.fit(this.bounds, this.aspect(), true);
    this.kick();
  }

  // The renderer's clock (ms); birth times and `at` arguments use it.
  now(): number {
    return performance.now() - this.t0 + this.skew;
  }

  private aspect() {
    return Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
  }


  private init() {
    const gl = this.canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.glBuffers = [];
    const prog = (vs: string, fs: string): Program => {
      const p = gl.createProgram()!;
      for (const [type, src] of [
        [gl.VERTEX_SHADER, vs],
        [gl.FRAGMENT_SHADER, fs],
      ] as const) {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
        gl.attachShader(p, s);
      }
      for (const [name, loc] of Object.entries(LOC)) gl.bindAttribLocation(p, loc, name);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      const u: Program['u'] = {};
      const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
      for (let i = 0; i < n; i++) {
        const info = gl.getActiveUniform(p, i)!;
        u[info.name] = gl.getUniformLocation(p, info.name);
      }
      return { p, u };
    };
    this.progs = {
      node: prog(S.NODE_VS, S.FRONT_FS),
      edge: prog(S.EDGE_VS, S.EDGE_FS),
      dagNode: prog(S.DAG_NODE_VS, S.DAG_NODE_FS),
      dagEdge: prog(S.DAG_EDGE_VS, S.EDGE_FS),
      leg: prog(S.LEG_VS, S.LEG_FS),
      stop: prog(S.STOP_VS, S.STOP_FS),
    };
    this.frontBuf = this.buffer(this.front.byteLength);
    this.frontVao = this.vao(this.frontBuf, FRONT_STRIDE, [
      [0, 2, 0],
      [1, 2, 2],
      [2, 1, 4],
      [3, 1, 5],
    ]);
    this.uploaded = 0;
    this.markerVao = this.staticVao(this.markers, 4, [
      [0, 2, 0],
      [2, 1, 2],
      [3, 1, 3],
    ]);
    this.dagNodeVao = this.dagNodes.length ? this.staticVao(this.dagNodes, 3, [[0, 2, 0], [3, 1, 2]]) : null;
    this.dagEdgeVao = this.dagEdges.length ? this.staticVao(this.dagEdges, 5, [[0, 2, 0], [1, 2, 2], [3, 1, 4]]) : null;
    for (const c of this.courses) this.uploadCourse(c);
    // Draw once with every program (all uniforms 0, so nothing shows) so the driver finishes
    // compiling now rather than in the breakthrough's first frame.
    gl.bindVertexArray(this.markerVao);
    for (const p of Object.values(this.progs)) {
      gl.useProgram(p.p);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 1);
    }
    gl.bindVertexArray(null);
  }

  private buffer(bytes: number, data?: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    else gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
    this.glBuffers.push(b);
    return b;
  }

  // attrs: [location, size, offset in floats]; one instance per stride
  private vao(buf: WebGLBuffer, stride: number, attrs: [number, number, number][]): WebGLVertexArrayObject {
    const gl = this.gl;
    const v = gl.createVertexArray()!;
    gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const [loc, size, off] of attrs) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    return v;
  }

  private staticVao(data: Float32Array, stride: number, attrs: [number, number, number][]) {
    return this.vao(this.buffer(0, data), stride, attrs);
  }

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.losses++;
    if (this.losses >= 2) {
      this.dead = true;
      this.opts.onFallback?.();
    }
  };

  private readonly onRestored = () => {
    if (this.dead) return;
    this.init();
    this.kick();
  };


  // Adds one level's drawn nodes with their birth times (renderer clock). Big levels are taken in
  // over several frames (at most ADD_PER_FRAME nodes each), so adding never stalls a frame; births
  // are staggered ahead of now, so nothing appears late.
  addBatch(b: LevelBatch, births: Float32Array): void {
    this.queue.push({ b, births, next: 0 });
    for (let i = 0; i < births.length; i++) this.lastBirth = Math.max(this.lastBirth, births[i]!);
    this.kick();
  }

  private readonly queue: { b: LevelBatch; births: Float32Array; next: number }[] = [];

  // Takes in up to `limit` queued nodes
  private take(limit: number) {
    while (limit > 0 && this.queue.length) {
      const q = this.queue[0]!;
      const n = Math.min(limit, q.b.ids.length - q.next);
      this.place(q.b, q.births, q.next, q.next + n);
      q.next += n;
      limit -= n;
      if (q.next === q.b.ids.length) this.queue.shift();
    }
  }

  private flush() {
    this.take(Infinity);
  }

  private place(b: LevelBatch, births: Float32Array, from: number, to: number) {
    this.ensure(this.count + (to - from));
    const f = this.front;
    const dens = densityStep(b.ids.length, b.depth);
    for (let i = from; i < to; i++) {
      const id = b.ids[i]!;
      const [x, y] = nodePosition(b.side, b.depth, b.angles[i]!, id);
      const [px, py] = b.depth <= 1 ? CENTRES[b.side]! : nodePosition(b.side, b.depth - 1, b.parentAngles[i]!, null);
      const o = this.count * FRONT_STRIDE;
      f[o] = x;
      f[o + 1] = y;
      f[o + 2] = px;
      f[o + 3] = py;
      f[o + 4] = births[i]!;
      f[o + 5] = b.side + 2 * Math.min(b.depth, 15) + 32 * dens;
      if (!this.where.has(id)) this.where.set(id, this.count);
      this.count++;
      if (x < this.bounds.minX) this.bounds.minX = x;
      if (x > this.bounds.maxX) this.bounds.maxX = x;
      if (y < this.bounds.minY) this.bounds.minY = y;
      if (y > this.bounds.maxY) this.bounds.maxY = y;
    }
    this.camera.fit(this.bounds, this.aspect());
  }

  // Grows the instance buffer (rare: DAG articles past the tier's budget)
  private ensure(n: number) {
    if (n * FRONT_STRIDE <= this.front.length) return;
    const bigger = new Float32Array(Math.max(n, (this.front.length / FRONT_STRIDE) * 2) * FRONT_STRIDE);
    bigger.set(this.front);
    this.front = bigger;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.frontBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.front.byteLength, gl.DYNAMIC_DRAW);
    this.uploaded = 0;
  }

  // Where a drawn article sits (world units), or null
  positionOf(id: number): [number, number] | null {
    this.flush();
    const i = this.where.get(id);
    return i === undefined ? null : [this.front[i * FRONT_STRIDE]!, this.front[i * FRONT_STRIDE + 1]!];
  }

  // The shortest-route DAG (layer 2). Its articles are all drawn.
  setDag(dag: Dag): void {
    const nodes: number[] = [];
    const meeting = new Set(dag.meeting);
    for (let i = 0; i < dag.ids.length; i++) {
      const id = dag.ids[i]!;
      const p = this.positionOf(id);
      if (!p) continue;
      const side = this.front[this.where.get(id)! * FRONT_STRIDE + 5]! % 2;
      nodes.push(p[0], p[1], side + (meeting.has(id) ? 2 : 0));
    }
    const edges: number[] = [];
    for (let e = 0; e < dag.edges.length; e += 2) {
      const a = this.positionOf(dag.ids[dag.edges[e]!]!), b = this.positionOf(dag.ids[dag.edges[e + 1]!]!);
      if (!a || !b) continue;
      const side = this.front[this.where.get(dag.ids[dag.edges[e + 1]!]!)! * FRONT_STRIDE + 5]! % 2;
      edges.push(a[0], a[1], b[0], b[1], side);
    }
    this.dagNodes = Float32Array.from(nodes);
    this.dagEdges = Float32Array.from(edges);
    this.dagNodeVao = this.dagNodes.length ? this.staticVao(this.dagNodes, 3, [[0, 2, 0], [3, 1, 2]]) : null;
    this.dagEdgeVao = this.dagEdges.length ? this.staticVao(this.dagEdges, 5, [[0, 2, 0], [1, 2, 2], [3, 1, 4]]) : null;
    this.kick();
  }

  // A course (layer 3): the stops' map ids from start to finish. Course 0 is the shortest route,
  // drawn on top; 1–4 are players. Stops that aren't drawn on the map (a player's detour) sit on
  // an arc between start and finish, below or above by course number, so routes stay apart;
  // stops shared with the map, and so with the shortest route, merge.
  setCourse(index: number, ids: number[], colour: string): void {
    const n = ids.length - 1;
    const S0 = CENTRES[0]!, F0 = CENTRES[1]!;
    const bulge = [-1.3, -1.3, 1.3, -2.2, 2.2][index % 5]!;
    const positions = ids.map((id, i): [number, number] => {
      if (i === 0) return [...S0];
      if (i === n) return [...F0];
      const p = this.positionOf(id);
      if (p) return p;
      const t = i / n;
      return [S0[0] + (F0[0] - S0[0]) * t, bulge * Math.sin(Math.PI * t)];
    });
    const legs: number[] = [];
    for (let i = 0; i < n; i++) legs.push(...positions[i]!, ...positions[i + 1]!, i);
    const stops: number[] = [];
    for (let i = 1; i < n; i++) stops.push(...positions[i]!, 0, i);
    const old = this.courses[index];
    const c: Course = { ids, colour: hex(colour), legs: Float32Array.from(legs), stops: Float32Array.from(stops), positions, start: Infinity, duration: 900, vaoLegs: null, vaoStops: null, buffers: [] };
    if (old) for (const b of old.buffers) this.gl.deleteBuffer(b);
    this.courses[index] = c;
    this.uploadCourse(c);
    for (const [x, y] of positions) {
      this.bounds.minX = Math.min(this.bounds.minX, x);
      this.bounds.maxX = Math.max(this.bounds.maxX, x);
      this.bounds.minY = Math.min(this.bounds.minY, y);
      this.bounds.maxY = Math.max(this.bounds.maxY, y);
    }
    this.camera.fit(this.bounds, this.aspect());
    this.kick();
  }

  private uploadCourse(c: Course) {
    const before = this.glBuffers.length;
    c.vaoLegs = c.legs.length ? this.staticVao(c.legs, 5, [[0, 2, 0], [1, 2, 2], [2, 1, 4]]) : null;
    c.vaoStops = c.stops.length ? this.staticVao(c.stops, 4, [[0, 2, 0], [2, 1, 2], [3, 1, 3]]) : null;
    c.buffers = this.glBuffers.slice(before);
  }

  // The breakthrough: the fronts dim to 12% over 300 ms while the DAG fades in.
  breakthrough(at = this.now()): void {
    this.dimStart = at;
    this.kick();
  }

  // Draws course `index` stop by stop from `at` (900 ms; a 200 ms fade when motion is reduced).
  drawCourse(index: number, at = this.now(), duration = 900): void {
    const c = this.courses[index];
    if (!c) return;
    c.start = at;
    c.duration = this.opts.reducedMotion ? 200 : duration;
    this.kick();
  }

  // Ends every animation now (skipping the reveal).
  skipToEnd(): void {
    this.flush();
    const ends = [this.lastBirth + 700, this.dimStart + 300, ...this.courses.map((c) => c.start + c.duration)].filter(Number.isFinite);
    const end = Math.max(0, ...ends);
    if (end > this.now()) this.skew += end - this.now();
    this.camera.fit(this.bounds, this.aspect(), true);
    this.kick();
  }

  // World position → CSS px in the canvas, for DOM labels
  project([x, y]: [number, number]): { x: number; y: number } {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const v = this.camera.view(w, h);
    const cx = v.x[0] * x + v.x[1] * y + v.x[2];
    const cy = v.y[0] * x + v.y[1] * y + v.y[2];
    return { x: ((cx + 1) / 2) * w, y: ((1 - cy) / 2) * h };
  }

  coursePositions(index: number): [number, number][] {
    return this.courses[index]?.positions ?? [];
  }


  private kick() {
    if (!this.raf && !this.dead && !this.gl.isContextLost()) this.raf = requestAnimationFrame(this.frame);
  }

  private animating(t: number): boolean {
    return this.queue.length > 0 || t < this.lastBirth + 700 || !this.camera.settled || t < this.dimStart + 300 || this.courses.some((c) => Number.isFinite(c.start) && t < c.start + c.duration + 50);
  }

  private readonly frame = (stamp: number) => {
    this.raf = 0;
    if (this.dead) return;
    const gap = this.lastFrame ? stamp - this.lastFrame : 16.7;
    this.lastFrame = stamp;
    const t = this.now();
    this.take(ADD_PER_FRAME);
    this.camera.step(gap);
    this.draw(t);
    this.opts.onFrame?.();
    if (this.animating(t)) {
      this.probe.record(stamp, gap);
      this.raf = requestAnimationFrame(this.frame);
    } else {
      this.lastFrame = 0;
      this.probe.pause();
    }
  };

  private dropTier() {
    const next = lowerTier(this.tier.name);
    if (!next) return;
    this.tier = TIERS[next];
    saveTier(next);
    this.opts.onTierDrop?.(this.tier);
  }

  private draw(t: number) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const dpr = Math.min(devicePixelRatio || 1, this.tier.dprCap);
    const cw = this.canvas.clientWidth, ch = this.canvas.clientHeight;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.camera.fit(this.bounds, this.aspect());
    }
    gl.viewport(0, 0, w, h);
    if (this.uploaded < this.count) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.frontBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, this.uploaded * FRONT_STRIDE * 4, this.front, this.uploaded * FRONT_STRIDE, (this.count - this.uploaded) * FRONT_STRIDE);
      this.uploaded = this.count;
    }
    const [vr, vg, vb] = hex(REVEAL.void);
    gl.clearColor(vr, vg, vb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    const view = this.camera.view(Math.max(1, cw), Math.max(1, ch));
    const reduced = this.opts.reducedMotion ? 1 : 0;
    const dimT = ease((t - this.dimStart) / 300);
    const dim = 1 - 0.88 * dimT;
    const common = (p: Program) => {
      gl.useProgram(p.p);
      gl.uniform3f(p.u.u_viewX!, ...view.x);
      gl.uniform3f(p.u.u_viewY!, ...view.y);
      gl.uniform2f(p.u.u_px!, 2 / Math.max(1, cw), 2 / Math.max(1, ch));
      gl.uniform1f(p.u.u_time!, t);
      gl.uniform1f(p.u.u_reduced!, reduced);
      if (p.u.u_start) gl.uniform3f(p.u.u_start, ...hex(REVEAL.start));
      if (p.u.u_finish) gl.uniform3f(p.u.u_finish, ...hex(REVEAL.finish));
      if (p.u.u_void) gl.uniform3f(p.u.u_void, vr, vg, vb);
    };

    // layer 1: fronts, additive
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.frontVao);
    if (this.tier.edges) {
      common(this.progs.edge);
      gl.uniform1f(this.progs.edge.u.u_dim!, dim);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.uploaded);
    }
    common(this.progs.node);
    gl.uniform1f(this.progs.node.u.u_dim!, dim);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.uploaded);

    // layer 2: the DAG, fading in with the dim
    if (dimT > 0) {
      if (this.dagEdgeVao) {
        common(this.progs.dagEdge);
        gl.uniform1f(this.progs.dagEdge.u.u_alpha!, dimT);
        gl.bindVertexArray(this.dagEdgeVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.dagEdges.length / 5);
      }
      if (this.dagNodeVao) {
        common(this.progs.dagNode);
        gl.uniform1f(this.progs.dagNode.u.u_alpha!, dimT);
        gl.bindVertexArray(this.dagNodeVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.dagNodes.length / 3);
      }
    }

    // layer 3: courses (premultiplied over), the highest index first so course 0 is on top
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (let i = this.courses.length - 1; i >= 0; i--) {
      const c = this.courses[i];
      if (!c || !Number.isFinite(c.start) || t < c.start) continue;
      const k = (t - c.start) / c.duration;
      const progress = reduced ? 1 : Math.min(1, Math.max(0, k));
      const fade = reduced ? Math.min(1, Math.max(0, k)) : 1;
      const legsN = c.legs.length / 5;
      if (c.vaoLegs) {
        common(this.progs.leg);
        const u = this.progs.leg.u;
        gl.uniform1f(u.u_progress!, progress);
        gl.uniform1f(u.u_legs!, legsN);
        gl.uniform1f(u.u_width!, 3);
        gl.uniform1f(u.u_fade!, fade);
        gl.uniform3f(u.u_color!, ...c.colour);
        gl.bindVertexArray(c.vaoLegs);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, legsN);
      }
      if (c.vaoStops) {
        common(this.progs.stop);
        const u = this.progs.stop.u;
        gl.uniform1f(u.u_progress!, progress);
        gl.uniform1f(u.u_legs!, legsN);
        gl.uniform1f(u.u_fade!, fade);
        gl.uniform3f(u.u_color!, ...c.colour);
        gl.bindVertexArray(c.vaoStops);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, c.stops.length / 4);
      }
    }
    // the start and finish markers, always
    common(this.progs.stop);
    gl.uniform1f(this.progs.stop.u.u_progress!, 1);
    gl.uniform1f(this.progs.stop.u.u_legs!, 1);
    gl.uniform1f(this.progs.stop.u.u_fade!, 1);
    gl.uniform3f(this.progs.stop.u.u_color!, 1, 1, 1);
    gl.bindVertexArray(this.markerVao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, 2);
    gl.bindVertexArray(null);
  }

  destroy(): void {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
