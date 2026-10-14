// Surprise me: a random course from the pipeline's pool at a difficulty. Only the label is known
// before the race; the pair's d and k stay in the file for the result.
export type Difficulty = 'easy' | 'medium' | 'hard';

export async function surprise(level: Difficulty, random = Math.random): Promise<{ from: string; to: string }> {
  const pools = (await (await fetch('/pools.json')).json()) as Record<Difficulty, { start: string; finish: string }[]>;
  const list = pools[level];
  const c = list[Math.floor(random() * list.length)]!;
  return { from: c.start, to: c.finish };
}
