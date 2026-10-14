// The room API from the browser (same origin). The seat token travels in X-Seat, never in a URL.
import type { ChallengeRow, CourseInfo, Mode } from '../../worker/protocol.ts';
import { readJson, writeJson } from '../data/storage.ts';

export type ApiError = 'expired' | 'resting' | 'turnstile' | 'name' | 'bad' | 'full' | 'exists' | 'network' | 'server';

export class RoomApiError extends Error {
  constructor(readonly code: ApiError) {
    super(code);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; seat?: string } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(init.seat ? { 'X-Seat': init.seat } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new RoomApiError('network');
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.ok) return json as T;
  const known: ApiError[] = ['expired', 'resting', 'turnstile', 'name', 'bad', 'full', 'exists'];
  throw new RoomApiError(known.includes(json.error as ApiError) ? (json.error as ApiError) : res.status === 404 ? 'expired' : 'server');
}

// The creator's seat token goes with the request and is kept for the new code, so they're its host
export async function createCourse(b: { mode: Mode; from: string; to: string; name: string; turnstile: string }): Promise<string> {
  const seat = newToken();
  const { code } = await call<{ code: string }>('/api/course', { body: b, seat });
  keepSeat(code, seat);
  return code;
}

export const getCourse = (code: string, seat: string) => call<CourseInfo>(`/api/course/${code}`, { seat });

export interface ChallengeTable {
  full: boolean;
  played: boolean;
  rows: ChallengeRow[];
}

export const addResult = (code: string, seat: string, b: { name: string; status: 'finished' | 'gaveup'; clicks: number; timeMs: number; route: string[] }) =>
  call<ChallengeTable>(`/api/course/${code}/result`, { body: b, seat });

// Rooms rest until the next 00:00 UTC once the daily quota is spent; shown in local time
export function restingUntil(now = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export const restingText = () => `Rooms are resting until ${restingUntil()} because of a daily limit. Solo races and the daily course still work.`;

// A random seat token per course, kept in localStorage (in memory if storage is blocked, so a
// reload then means a new seat)
const SEATS = 'wikiracer.seats';
const memory = new Map<string, string>();

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function keepSeat(code: string, seat: string) {
  const all = readJson<Record<string, string>>(SEATS, {});
  memory.set(code, seat);
  if (all[code] !== seat) writeJson(SEATS, { ...all, [code]: seat });
}

export function seatFor(code: string): string {
  const seat = readJson<Record<string, string>>(SEATS, {})[code] ?? memory.get(code) ?? newToken();
  keepSeat(code, seat);
  return seat;
}

const NAME = 'wikiracer.name';
export const savedName = () => readJson<string>(NAME, '');
export const saveName = (name: string) => writeJson(NAME, name);
