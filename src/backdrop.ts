// The site's moving background: a sparse web of articles drifting slowly, where now and then one
// link lights up and a pulse travels it, start green to finish pink, like a click. Faint grey and a
// touch blurred, so it reads as texture. During a race (html.racing) it fades to a third and holds
// still, so nothing moves behind the article; with reduced motion it's always still. It pauses
// while the tab is hidden and draws at about 30 fps.

const SPEED = 1.08; // a touch faster than the first mockup
const REACH = 170; // px: nodes closer than this are joined
const FRAME_MS = 32;

interface Node {
  x: number;
  y: number;
  a: number; // phase
  r: number; // drift radius
  s: number; // drift speed
}

interface Pulse {
  i: number;
  j: number;
  born: number;
}

export function startBackdrop() {
  if (typeof window === 'undefined' || document.querySelector('canvas.backdrop')) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const html = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let w = 0;
  let h = 0;
  let nodes: Node[] = [];
  let pulses: Pulse[] = [];
  let colours = { ink2: '', signal: '', flare: '' };
  let last = 0;
  let held: number | null = null; // the time a still frame shows
  let drawnStill = '';

  const rgba = (hex: string, a: number) => {
    const v = parseInt(hex.replace('#', ''), 16);
    return Number.isNaN(v) ? `rgba(128,128,128,${a})` : `rgba(${v >> 16},${(v >> 8) & 255},${v & 255},${a})`;
  };
  // the tokens as hex (wide-gamut screens get oklch for the accents, so fall back to the sRGB ones)
  const token = (name: string, fallback: string) => {
    const v = getComputedStyle(html).getPropertyValue(name).trim();
    return v.startsWith('#') ? v : fallback;
  };
  function readColours() {
    const dark = getComputedStyle(html).colorScheme.includes('dark');
    colours = {
      ink2: token('--ink-2', dark ? '#a0a6b8' : '#5b6072'),
      signal: token('--signal', dark ? '#4fd8a4' : '#0a7a57'),
      flare: token('--flare', dark ? '#ff74ac' : '#d1246b'),
    };
    drawnStill = '';
  }

  function resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth;
    h = innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    // about one node per 16,000 px², at most 90
    const n = Math.round(Math.min(90, (w * h) / 16000));
    nodes = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      a: Math.random() * Math.PI * 2,
      r: 20 + Math.random() * 40,
      s: (0.00004 + Math.random() * 0.00006) * SPEED,
    }));
    pulses = [];
    drawnStill = '';
  }

  function draw(t: number, strength: number, moving: boolean) {
    const c = ctx!;
    c.clearRect(0, 0, w, h);
    const ps = nodes.map((p) => [p.x + Math.cos(p.a + t * p.s) * p.r, p.y + Math.sin(p.a * 1.3 + t * p.s * 0.8) * p.r] as const);
    const edges: [number, number][] = [];
    c.lineWidth = 1;
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const d = Math.hypot(ps[i]![0] - ps[j]![0], ps[i]![1] - ps[j]![1]);
        if (d >= REACH) continue;
        edges.push([i, j]);
        c.strokeStyle = rgba(colours.ink2, (1 - d / REACH) * 0.22 * strength);
        c.beginPath();
        c.moveTo(ps[i]![0], ps[i]![1]);
        c.lineTo(ps[j]![0], ps[j]![1]);
        c.stroke();
      }
    }
    c.fillStyle = rgba(colours.ink2, 0.4 * strength);
    for (const [x, y] of ps) {
      c.beginPath();
      c.arc(x, y, 1.8, 0, Math.PI * 2);
      c.fill();
    }
    if (!moving) return;
    // a click: one link lights up, the pulse runs it in 1.7 s, then fades
    const run = 1800 / SPEED;
    const fadeOut = 800 / SPEED;
    if (edges.length && pulses.length < 3 && Math.random() < 0.03) {
      const [i, j] = edges[Math.floor(Math.random() * edges.length)]!;
      pulses.push({ i, j, born: t });
    }
    pulses = pulses.filter((q) => t - q.born < run + fadeOut && q.i < ps.length && q.j < ps.length);
    for (const q of pulses) {
      const a = ps[q.i]!;
      const b = ps[q.j]!;
      const u = Math.min(1, (t - q.born) / run);
      const fade = 1 - Math.max(0, (t - q.born - run) / fadeOut);
      const x = a[0] + (b[0] - a[0]) * u;
      const y = a[1] + (b[1] - a[1]) * u;
      const g = c.createLinearGradient(a[0], a[1], b[0], b[1]);
      g.addColorStop(0, rgba(colours.signal, 0.7 * fade));
      g.addColorStop(1, rgba(colours.flare, 0.7 * fade));
      c.strokeStyle = g;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(a[0], a[1]);
      c.lineTo(x, y);
      c.stroke();
      c.fillStyle = rgba(u < 1 ? colours.signal : colours.flare, 0.7 * fade);
      c.beginPath();
      c.arc(x, y, 2.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  function frame(now: number) {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < FRAME_MS) return;
    last = now;
    const racing = html.classList.contains('racing');
    const still = racing || reduce.matches;
    if (still) {
      // one frame, drawn again only when something about it changes
      held ??= now;
      const key = `${racing}|${w}x${h}|${colours.ink2}`;
      if (key === drawnStill) return;
      drawnStill = key;
      draw(held, racing ? 0.35 : 1, false);
      return;
    }
    held = null;
    drawnStill = '';
    draw(now, 1, true);
  }

  readColours();
  resize();
  addEventListener('resize', resize);
  // the theme can change from the menu (data-theme) or the system
  new MutationObserver(readColours).observe(html, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColours);
  requestAnimationFrame(frame);
}
