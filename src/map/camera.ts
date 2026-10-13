// The reveal's camera (spec §5.6 "Layout"): fits the drawn bounds with a critically damped spring.
// No pan or zoom; the result panel holds the detail.

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// A critically damped spring towards `target`: x'' = -ω²(x - target) - 2ω x'
class Spring {
  v = 0;
  constructor(
    public x: number,
    public target: number,
  ) {}

  step(dt: number, omega: number): void {
    // exact solution over dt, so big frame gaps can't overshoot
    const d = this.x - this.target;
    const e = Math.exp(-omega * dt);
    const c = this.v + omega * d;
    this.x = this.target + (d + c * dt) * e;
    this.v = (c - omega * (d + c * dt)) * e;
  }

  get settled(): boolean {
    return Math.abs(this.x - this.target) < 1e-4 && Math.abs(this.v) < 1e-4;
  }
}

export class Camera {
  private readonly cx = new Spring(0, 0);
  private readonly cy = new Spring(0, 0);
  // world units visible along the canvas's long axis
  private readonly span = new Spring(8, 8);
  private readonly omega: number;

  constructor({ omega = 5 }: { omega?: number } = {}) {
    this.omega = omega;
  }

  // Fit `b` with a margin; world x is the start → finish axis, shown along the canvas's long axis.
  fit(b: Bounds, aspect: number, immediate = false): void {
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    const long = Math.max(aspect, 1 / aspect);
    // the short axis must hold h, the long axis w
    const span = Math.max(w, h * long, 3) * 1.18;
    this.cx.target = (b.minX + b.maxX) / 2;
    this.cy.target = (b.minY + b.maxY) / 2;
    this.span.target = span;
    if (immediate) for (const s of [this.cx, this.cy, this.span]) { s.x = s.target; s.v = 0; }
  }

  step(dtMs: number): void {
    const dt = Math.min(dtMs, 100) / 1000;
    for (const s of [this.cx, this.cy, this.span]) s.step(dt, this.omega);
  }

  get settled(): boolean {
    return this.cx.settled && this.cy.settled && this.span.settled;
  }

  // World → clip as two rows of an affine map. Landscape: world x runs left → right. Portrait:
  // world x runs top → bottom (the start above the finish).
  view(widthPx: number, heightPx: number): { x: [number, number, number]; y: [number, number, number] } {
    const portrait = heightPx > widthPx;
    const longPx = Math.max(widthPx, heightPx);
    const k = 2 / this.span.x; // clip units per world unit along the long axis
    // keep world units square on screen
    const kx = portrait ? (k * longPx) / widthPx : k;
    const ky = portrait ? k : (k * longPx) / heightPx;
    const cx = this.cx.x, cy = this.cy.x;
    if (!portrait) return { x: [kx, 0, -kx * cx], y: [0, ky, -ky * cy] };
    // clip x = (wy - cy) * kx, clip y = -(wx - cx) * ky
    return { x: [0, kx, -kx * cy], y: [-ky, 0, ky * cx] };
  }
}
