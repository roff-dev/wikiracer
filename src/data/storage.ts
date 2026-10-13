// localStorage behind try/catch: blocked or full storage turns these features
// off silently, and every page still renders without them.

export function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage blocked or full
  }
}

const FINISHED = 'wikiracer.finished';

// A course is its start and finish titles, in underscore form
export const courseKey = (from: string, to: string) => `${from}|${to}`;

// Courses this browser has finished: a shared result shows its routes straight away for them.
export function hasFinished(from: string, to: string): boolean {
  return readJson<string[]>(FINISHED, []).includes(courseKey(from, to));
}

export function markFinished(from: string, to: string): void {
  const all = readJson<string[]>(FINISHED, []);
  const key = courseKey(from, to);
  if (!all.includes(key)) writeJson(FINISHED, [...all, key]);
}
