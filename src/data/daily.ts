// The daily course: which day it is for the visitor, and its course number.

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

// The daily course's number for a date (YYYY-MM-DD), from daily.json's launch date; null when
// the file can't be read.
export async function dailyNumber(date: string): Promise<number | null> {
  try {
    const { launch } = (await (await fetch('/daily.json')).json()) as { launch: string };
    const n = daysBetween(launch, date) + 1;
    return n >= 1 ? n : null;
  } catch {
    return null;
  }
}

export interface DailyDay {
  date: string;
  start: string;
  finish: string;
  label: 'easy' | 'medium' | 'hard';
  d: number;
  k: number;
}

export interface DailySchedule {
  launch: string;
  days: DailyDay[];
}

let schedule: Promise<DailySchedule | null> | null = null;

// daily.json, read once per page; null when it can't be read
export function loadSchedule(): Promise<DailySchedule | null> {
  return (schedule ??= fetch('/daily.json')
    .then((r) => (r.ok ? (r.json() as Promise<DailySchedule>) : null))
    .catch(() => null));
}

// The course for a date, with its number; null when the schedule doesn't reach that day
export function courseFor(s: DailySchedule, date: string): { day: DailyDay; number: number } | null {
  const day = s.days.find((x) => x.date === date);
  return day ? { day, number: daysBetween(s.launch, date) + 1 } : null;
}
