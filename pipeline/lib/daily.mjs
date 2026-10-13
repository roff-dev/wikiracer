// The daily schedule: Medium Monday to Saturday, Hard on Sunday, no article repeats
// within 60 days, and append-only: existing days are never rewritten.

export const REPEAT_DAYS = 60;

const DAY = 86_400_000;
const toUtc = (date) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10));
export const addDays = (date, n) => new Date(toUtc(date) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((toUtc(b) - toUtc(a)) / DAY);
// 0 = Sunday
export const weekday = (date) => new Date(toUtc(date)).getUTCDay();
export const labelForDate = (date) => (weekday(date) === 0 ? 'hard' : 'medium');

// Extends `schedule` ({ launch, days: [{ date, start, finish, label, d, k }] }) through `until`,
// taking pairs in order from candidates.medium / candidates.hard. Returns a new schedule; the
// existing days are copied unchanged. Throws if a label's candidates run out.
export function extendDaily(schedule, candidates, until) {
  const days = [...schedule.days];
  const used = { medium: 0, hard: 0 };
  const taken = new Set(days.map((x) => `${x.start}\n${x.finish}`));
  let date = days.length ? addDays(days.at(-1).date, 1) : schedule.launch;
  while (date <= until) {
    const label = labelForDate(date);
    const recent = new Set(days.slice(-REPEAT_DAYS).flatMap((x) => [x.start, x.finish]));
    const list = candidates[label];
    let pick = null;
    while (used[label] < list.length) {
      const p = list[used[label]++];
      if (!recent.has(p.start) && !recent.has(p.finish) && !taken.has(`${p.start}\n${p.finish}`)) { pick = p; break; }
    }
    if (!pick) throw new Error(`daily: ran out of ${label} pairs at ${date}`);
    days.push({ date, start: pick.start, finish: pick.finish, label, d: pick.d, k: pick.k });
    taken.add(`${pick.start}\n${pick.finish}`);
    date = addDays(date, 1);
  }
  return { launch: schedule.launch, days };
}

// Fails unless every day of `before` is in `after`, at the same place and unchanged.
export function assertAppendOnly(before, after) {
  if (before.launch !== after.launch) throw new Error(`daily: launch changed from ${before.launch} to ${after.launch}`);
  before.days.forEach((x, i) => {
    const y = after.days[i];
    if (!y || JSON.stringify(x) !== JSON.stringify(y)) throw new Error(`daily: ${x.date} would change`);
  });
}
