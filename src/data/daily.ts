// The daily course (spec §3.8): which day it is for the visitor, and its course number.

// The visitor's local calendar date as YYYY-MM-DD.
export function localDateKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Calendar days from a to b (both YYYY-MM-DD), counted in UTC so DST never adds or drops an hour.
export function daysBetween(a: string, b: string): number {
  const utc = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

// Course number: days since launch + 1, on the visitor's local date.
export function courseNumber(launch: string, now: Date): number {
  return daysBetween(launch, localDateKey(now)) + 1;
}
