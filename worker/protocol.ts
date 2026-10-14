// Messages between a browser and a live room's Course object (JSON text frames, at most 64 KB),
// and the shapes the HTTP API returns. Shared by worker/ and src/room/.

export type Mode = 'live' | 'challenge';
// 'clicks': fewest clicks wins, time breaks ties; 'time': first to the finish wins, on the room's clock
export type Scoring = 'clicks' | 'time';
export type Phase = 'lobby' | 'countdown' | 'race' | 'standings';
// 'watching': joined during a race, plays from the next course; 'dnf': still racing at the 30-minute end
export type PlayerStatus = 'waiting' | 'racing' | 'finished' | 'gaveup' | 'dnf' | 'watching' | 'away';
// 'exists': this seat already has a challenge result
export type ErrorCode = 'full' | 'name' | 'expired' | 'rate' | 'bad' | 'started' | 'exists';

export const MAX_FRAME = 64 * 1024;

export type ClientMessage =
  | { t: 'hello'; seat: string; name: string }
  | { t: 'course'; from: string; to: string }
  | { t: 'scoring'; scoring: Scoring }
  | { t: 'start' }
  | { t: 'move'; click: number; title: string }
  | { t: 'finish'; clicks: number; timeMs: number; route: string[] }
  | { t: 'giveup'; clicks: number }
  | { t: 'leave' };

export interface PlayerState {
  n: number;
  name: string;
  clicks: number;
  status: PlayerStatus;
  timeMs?: number;
}

// Never carries a title other than the course's start and finish
export interface RoomState {
  now: number;
  phase: Phase;
  round: number;
  from: string;
  to: string;
  startAt?: number;
  scoring: Scoring;
  host: number;
  players: PlayerState[];
}

export interface StandingRow {
  n: number;
  name: string;
  place: number;
  status: PlayerStatus;
  clicks: number;
  timeMs: number | null;
  route: string[];
}

export type ServerMessage =
  | { t: 'welcome'; you: number; now: number; state: RoomState }
  | ({ t: 'state' } & RoomState)
  | { t: 'standings'; round: number; rows: StandingRow[] }
  | { t: 'error'; code: ErrorCode };

// A challenge table row; `route` only once the viewer has a result of their own
export interface ChallengeRow {
  name: string;
  status: 'finished' | 'gaveup';
  clicks: number;
  timeMs: number;
  at: number;
  you: boolean;
  place: number;
  route?: string[];
}

// GET /api/course/:code
export type CourseInfo =
  | ({ mode: 'live'; created: number } & RoomState)
  | { mode: 'challenge'; from: string; to: string; created: number; full: boolean; played: boolean; rows: ChallengeRow[] };
