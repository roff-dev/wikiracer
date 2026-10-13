import { DurableObject } from 'cloudflare:workers';
import type { Env } from './index';

// One object per room or challenge code. Its state and API arrive in M4.
export class Course extends DurableObject<Env> {}
