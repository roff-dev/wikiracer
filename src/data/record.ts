// The daily record kept in this browser (spec §3.8): each daily course finished, by date, with its
// clicks and time. The streak and the best result are worked out from it, so they can't drift
// apart from what was played. Behind try/catch (storage.ts): without storage, there's no record.
import { readJson, writeJson } from './storage.ts';

export interface DailyRun {
  clicks: number;
  seconds: number;
}

export type DailyRecord = Record<string, DailyRun>;

const KEY = 'wikiracer.daily';

export const readRecord = (): DailyRecord => readJson<DailyRecord>(KEY, {});

// The first finish of a day stands: a replay after seeing the reveal isn't a fair result
export function recordDaily(date: string, run: DailyRun): void {
  const all = readRecord();
  if (!all[date]) writeJson(KEY, { ...all, [date]: run });
}

// Days in a row with a finished daily, ending today, or yesterday while today is still open
export function streak(record: DailyRecord, today: string): number {
  const dates = new Set(Object.keys(record));
  const back = (s: string, n: number) => {
    const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) - n));
    return d.toISOString().slice(0, 10);
  };
  let day = dates.has(today) ? today : back(today, 1);
  let n = 0;
  while (dates.has(day)) {
    n++;
    day = back(day, 1);
  }
  return n;
}

export interface Best extends DailyRun {
  date: string;
  // clicks over the shortest route
  over: number;
}

// The best finished daily: fewest clicks over the shortest route, then the quicker time. `pars`
// gives each day's shortest length (from daily.json); days without one are left out. Only past
// and finished days are ever passed in, so this never shows an unplayed course's par.
export function best(record: DailyRecord, pars: Map<string, number>): Best | null {
  let top: Best | null = null;
  for (const [date, run] of Object.entries(record)) {
    const d = pars.get(date);
    if (d === undefined) continue;
    const b = { date, ...run, over: run.clicks - d };
    if (!top || b.over < top.over || (b.over === top.over && b.seconds < top.seconds)) top = b;
  }
  return top;
}
