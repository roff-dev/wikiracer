// Turnstile: the Worker checks the token from the friends sheet with Cloudflare before it creates
// a room or challenge.

// Cloudflare's test secrets (always pass, always fail, token spent) answer for any hostname
const TEST_SECRET = /^[123]x0{30,}AA$/;

export async function verifyTurnstile(token: unknown, secret: string, ip: string | null, hostname: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (typeof token !== 'string' || !token || token.length > 2048 || !secret) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const res = await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const out = (await res.json()) as { success?: boolean; hostname?: string };
    return out.success === true && (TEST_SECRET.test(secret) || out.hostname === hostname);
  } catch {
    return false;
  }
}
