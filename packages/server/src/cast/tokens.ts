// Short-lived opaque cast tokens, scoped to a room code.
//
// Chromecast guide §5 / §7: "cast endpoints validate a scoped access token
// even for 'public' data". Room codes are 4 digits and therefore trivially
// guessable, so `receiver:subscribe` and GET /api/cast/pending both require a
// token minted for that specific code.
//
// In-memory only, no JWT, no persistence — rooms are ephemeral and a restart
// invalidating every token is the correct behaviour.
import { randomBytes } from 'node:crypto';

export const CAST_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

interface TokenRecord {
  code: string;
  expiresAt: number;
}

const tokens = new Map<string, TokenRecord>();

/** Drop expired entries. Called lazily on every mint/verify. */
function sweep(now: number): void {
  for (const [token, rec] of tokens) {
    if (rec.expiresAt <= now) tokens.delete(token);
  }
}

export function mintCastToken(code: string, now = Date.now()): { token: string; expiresAt: number } {
  sweep(now);
  const token = randomBytes(24).toString('base64url');
  const expiresAt = now + CAST_TOKEN_TTL_MS;
  tokens.set(token, { code, expiresAt });
  return { token, expiresAt };
}

/** True only for a live token minted for exactly this room code. */
export function verifyCastToken(token: string, code: string, now = Date.now()): boolean {
  sweep(now);
  if (typeof token !== 'string' || token.length === 0) return false;
  const rec = tokens.get(token);
  if (!rec) return false;
  if (rec.expiresAt <= now) {
    tokens.delete(token);
    return false;
  }
  return rec.code === code;
}

/** Test hook — drops every issued token. */
export function __resetCastTokens(): void {
  tokens.clear();
}
