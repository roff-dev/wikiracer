export { Course } from './course';

export interface Env {
  COURSE: DurableObjectNamespace;
}

// Runs only for /api/* (assets.run_worker_first); every other path is a static asset
export default {
  async fetch(): Promise<Response> {
    // No routes yet: rooms and challenges arrive in M4
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
