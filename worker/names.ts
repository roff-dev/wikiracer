// Room codes, nicknames and the shared clock: pure functions, used by the Worker and the pages.

// 31 characters: no 0, O, 1, I or L, so a code read aloud or off a screen can't be mistyped
export const CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_RE = /^[2-9A-HJKMNP-Z]{6}$/;

// Six characters by rejection sampling: bytes from 248 up are drawn again, so each character
// is equally likely (248 = 8 × 31).
export function drawCode(randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let code = '';
  while (code.length < 6) {
    for (const b of randomBytes(8)) {
      if (b < 248 && code.length < 6) code += CODE_CHARS[b % 31];
    }
  }
  return code;
}

// Typed or pasted, in any case and with spaces or dashes: "k7m 2qx" → "K7M2QX"; null if not a code
export function normaliseCode(input: string): string | null {
  const c = input.replace(/[\s-]/g, '').toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

// Grouped 3 + 3 for display
export const showCode = (code: string) => `${code.slice(0, 3)} ${code.slice(3)}`;

export const NAME_MAX = 16;
const NAME_RE = /^[\p{L}\p{M}\p{N} _.'-]+$/u;

// A short blocklist of slurs, ROT13-encoded so the source doesn't spell them out
const BLOCKED = ['avttre', 'avttn', 'snttbg', 'snt', 'ergneq', 'genaal', 'fcvp', 'puvax', 'xvxr', 'jrgonpx', 'qlxr', 'pbba', 'tbbx']
  .map((w) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97)));

// Letters only, look-alike digits read as letters, accents dropped
function skeleton(name: string): string {
  const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[0134578]/g, (c) => leet[c]!)
    .replace(/[^a-z]/g, '');
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'length' | 'chars' | 'blocked' };

// Nicknames: 1–16 characters after trimming (inner runs of spaces kept to one), letters and
// digits in any script, spaces and - _ . '
export function checkName(raw: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, ' ');
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX) return { ok: false, reason: 'length' };
  if (!NAME_RE.test(name)) return { ok: false, reason: 'chars' };
  const s = skeleton(name);
  // short words only as the whole name, longer ones anywhere inside it
  if (BLOCKED.some((w) => (w.length <= 4 ? s === w || s === `${w}s` : s.includes(w)))) return { ok: false, reason: 'blocked' };
  return { ok: true, name };
}

// A clash with a name already in the course (any case) gets " 2", " 3", … (trimmed to fit 16)
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const base = [...name].slice(0, NAME_MAX - suffix.length).join('').trimEnd();
    const candidate = base + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// The client's offset from the object's clock, from one hello → welcome round trip: the server
// read `serverNow` halfway (on average) between sending and receiving.
export const clockOffset = (serverNow: number, sentAt: number, receivedAt: number) => serverNow - (sentAt + receivedAt) / 2;
