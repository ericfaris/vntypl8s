// Room lifecycle + cast-token scoping.
//
// The closeIfEmpty grace window is a regression guard for a real Chromecast
// bug: a receiver reload (the receiver.html HTTP-polling fallback redirects
// the page, which is a real socket disconnect) briefly leaves a brand-new
// room with zero players and zero receivers. Without the grace period,
// closeIfEmpty destroyed the room out from under the in-progress host join,
// permanently stranding the TV on "Waiting for a room…".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyntheticDeckSource } from '../../engine/deck.js';
import { RoomManager } from '../rooms.js';
import {
  CAST_TOKEN_TTL_MS,
  __resetCastTokens,
  mintCastToken,
  verifyCastToken,
} from '../../cast/tokens.js';

function makeManager(): RoomManager {
  return new RoomManager(new SyntheticDeckSource());
}

describe('RoomManager.generateCode', () => {
  it('issues unique 4-digit codes across many creates', () => {
    const rooms = makeManager();
    const codes = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = rooms.create().engine.room.code;
      expect(code).toMatch(/^\d{4}$/);
      expect(codes.has(code)).toBe(false);
      codes.add(code);
    }
    expect(codes.size).toBe(500);
  });
});

describe('RoomManager.closeIfEmpty', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('protects a brand-new empty room (grace period)', () => {
    const rooms = makeManager();
    const code = rooms.create().engine.room.code;
    expect(rooms.closeIfEmpty(code)).toBe(false);
    expect(rooms.has(code)).toBe(true);
  });

  it('closes an empty room once the grace period elapses', () => {
    const rooms = makeManager();
    const code = rooms.create().engine.room.code;
    vi.advanceTimersByTime(61_000);
    expect(rooms.closeIfEmpty(code)).toBe(true);
    expect(rooms.has(code)).toBe(false);
  });

  it('never closes a room with a connected player, grace period or not', () => {
    const rooms = makeManager();
    const runtime = rooms.create();
    expect(runtime.engine.join({ displayName: 'Eric' }).ok).toBe(true);
    vi.advanceTimersByTime(61_000);
    expect(rooms.closeIfEmpty(runtime.engine.room.code)).toBe(false);
  });

  it('receivers alone keep a room alive', () => {
    const rooms = makeManager();
    const runtime = rooms.create();
    runtime.receivers.add('socket-1');
    vi.advanceTimersByTime(61_000);
    expect(rooms.closeIfEmpty(runtime.engine.room.code)).toBe(false);
    expect(rooms.has(runtime.engine.room.code)).toBe(true);

    runtime.receivers.delete('socket-1');
    expect(rooms.closeIfEmpty(runtime.engine.room.code)).toBe(true);
  });
});

describe('pending cast code', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is served inside the 120s window and expires after it', () => {
    const rooms = makeManager();
    const code = rooms.create().engine.room.code;
    rooms.setPendingCastCode(code);
    expect(rooms.getPendingCastCode()).toBe(code);
    vi.advanceTimersByTime(121_000);
    expect(rooms.getPendingCastCode()).toBeNull();
  });

  it('is not served for a room that no longer exists', () => {
    const rooms = makeManager();
    const code = rooms.create().engine.room.code;
    rooms.setPendingCastCode(code);
    rooms.close(code);
    expect(rooms.getPendingCastCode()).toBeNull();
  });
});

describe('cast tokens', () => {
  beforeEach(() => __resetCastTokens());

  it('verifies a token only against the code it was minted for', () => {
    const { token } = mintCastToken('1234');
    expect(verifyCastToken(token, '1234')).toBe(true);
    expect(verifyCastToken(token, '9999')).toBe(false);
  });

  it('rejects unknown and empty tokens', () => {
    expect(verifyCastToken('not-a-token', '1234')).toBe(false);
    expect(verifyCastToken('', '1234')).toBe(false);
  });

  it('rejects an expired token', () => {
    const now = 1_000_000;
    const { token, expiresAt } = mintCastToken('1234', now);
    expect(expiresAt).toBe(now + CAST_TOKEN_TTL_MS);
    expect(verifyCastToken(token, '1234', now + CAST_TOKEN_TTL_MS - 1)).toBe(true);
    expect(verifyCastToken(token, '1234', now + CAST_TOKEN_TTL_MS)).toBe(false);
  });

  it('mints opaque, unguessable, unique tokens', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token } = mintCastToken('1234');
      expect(token.length).toBeGreaterThanOrEqual(16);
      expect(token).not.toContain('1234');
      expect(seen.has(token)).toBe(false);
      seen.add(token);
    }
  });
});
