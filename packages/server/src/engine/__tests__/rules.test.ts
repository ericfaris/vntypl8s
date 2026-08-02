import { describe, expect, it } from 'vitest';
import {
  FILLER_CARDS_PER_ROUND,
  OWNER_CARDS,
  PLATE_ALPHABET,
  REQUIREMENT_CARDS,
  TOTAL_ROUNDS,
  validatePlate,
} from '@vntypl8s/shared';
import { addPlayers, checkInvariants, makeEngine, type Seat } from './harness.js';
import type { GameEngine } from '../engine.js';

/** Compose a legal plate for `pid` that does or doesn't satisfy their card. */
function writeFor(engine: GameEngine, pid: string, meet: boolean): string {
  const st = engine.room.round!.playerStates.find((s) => s.playerId === pid)!;
  const req = st.requirementsCard.chars;
  if (meet) return req.padEnd(4, 'B').slice(0, 8);
  // Reverse the required chars — same characters, wrong order.
  const scrambled = [...req].reverse().join('');
  // Guard: a palindrome would still satisfy. Fall back to a plate with none
  // of the required chars at all.
  const plate = scrambled === req ? 'BBBB' : scrambled;
  return plate;
}

function startGame(seed: number, n: number): { engine: GameEngine; seats: Seat[] } {
  const { engine } = makeEngine(seed);
  const seats = addPlayers(engine, n);
  const r = engine.start(seats[0]!.id);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return { engine, seats };
}

/** Everybody writes + submits, in the given order. */
function writeRound(engine: GameEngine, order: string[], meet: (pid: string) => boolean): void {
  for (const pid of order) {
    const plate = writeFor(engine, pid, meet(pid));
    const sp = engine.setPlate(pid, plate);
    expect(sp.ok, `${pid}: ${JSON.stringify(sp)}`).toBe(true);
    expect(engine.submitPlate(pid).ok).toBe(true);
  }
}

describe('scoring rules', () => {
  it('(a) guessed + requirements met: guesser takes the Owner card, Active Player takes the Requirements card', () => {
    const { engine, seats } = startGame(11, 3);
    writeRound(engine, seats.map((s) => s.id), () => true);
    const active = engine.activePlayerId()!;
    const guesser = seats.find((s) => s.id !== active)!.id;

    expect(engine.award(active, guesser).ok).toBe(true);
    const res = engine.room.round!.currentResolution!;
    expect(res.outcome).toBe('GUESSED');
    expect(res.requirementsMet).toBe(true);
    expect(res.requirementsScored).toBe(true);

    const guesserP = engine.room.players.find((p) => p.id === guesser)!;
    const activeP = engine.room.players.find((p) => p.id === active)!;
    expect(guesserP.ownerPile).toHaveLength(1);
    expect(guesserP.ownerPile[0]!.id).toBe(res.revealedOwnerCard.id);
    expect(guesserP.requirementsPile).toHaveLength(0);
    expect(activeP.ownerPile).toHaveLength(0);
    expect(activeP.requirementsPile).toHaveLength(1);
    expect(activeP.requirementsPile[0]!.id).toBe(res.revealedRequirementsCard.id);

    // The card leaves the grid as SCORED.
    const gc = engine.room.round!.grid.find((g) => g.card.id === res.revealedOwnerCard.id)!;
    expect(gc.status).toBe('SCORED');
    checkInvariants(engine);
  });

  it('(b) guessed + requirements NOT met: guesser scores, Active Player gets nothing', () => {
    const { engine, seats } = startGame(12, 3);
    writeRound(engine, seats.map((s) => s.id), () => false);
    const active = engine.activePlayerId()!;
    const guesser = seats.find((s) => s.id !== active)!.id;

    expect(engine.award(active, guesser).ok).toBe(true);
    const res = engine.room.round!.currentResolution!;
    expect(res.requirementsMet).toBe(false);
    expect(res.requirementsScored).toBe(false);
    expect(engine.room.players.find((p) => p.id === guesser)!.ownerPile).toHaveLength(1);
    expect(engine.room.players.find((p) => p.id === active)!.requirementsPile).toHaveLength(0);
    checkInvariants(engine);
  });

  it('(c) missed + requirements met: nobody scores, the card is discarded', () => {
    const { engine, seats } = startGame(13, 3);
    writeRound(engine, seats.map((s) => s.id), () => true);
    const active = engine.activePlayerId()!;

    expect(engine.award(active, null).ok).toBe(true);
    const res = engine.room.round!.currentResolution!;
    expect(res.outcome).toBe('MISSED');
    expect(res.requirementsMet).toBe(true);
    expect(res.requirementsScored).toBe(false);
    for (const p of engine.room.players) {
      expect(p.ownerPile).toHaveLength(0);
      expect(p.requirementsPile).toHaveLength(0);
    }
    const gc = engine.room.round!.grid.find((g) => g.card.id === res.revealedOwnerCard.id)!;
    expect(gc.status).toBe('DISCARDED');
    checkInvariants(engine);
  });

  it('(d) the Active Player cannot award themselves, or a non-player', () => {
    const { engine, seats } = startGame(14, 3);
    writeRound(engine, seats.map((s) => s.id), () => true);
    const active = engine.activePlayerId()!;

    expect(engine.award(active, active).ok).toBe(false);
    expect(engine.award(active, 'p_nobody').ok).toBe(false);
    // ...and a non-active player cannot award at all.
    const other = seats.find((s) => s.id !== active)!.id;
    expect(engine.award(other, active).ok).toBe(false);
    expect(engine.room.round!.currentResolution).toBeNull();
    checkInvariants(engine);
  });

  it('(e) turn order equals submit order (ties broken by joinOrder)', () => {
    const { engine, seats } = startGame(15, 5);
    const order = [seats[3]!.id, seats[0]!.id, seats[4]!.id, seats[1]!.id, seats[2]!.id];
    for (const pid of order) {
      expect(engine.setPlate(pid, writeFor(engine, pid, true)).ok).toBe(true);
      expect(engine.submitPlate(pid).ok).toBe(true);
    }
    // All submits share the frozen clock time, so joinOrder is the tiebreak.
    expect(engine.room.round!.turnOrder).toEqual(seats.map((s) => s.id));
    checkInvariants(engine);
  });

  it('(e2) turn order follows real submit times when the clock advances', () => {
    const h = makeEngine(156);
    const seats2 = addPlayers(h.engine, 4);
    expect(h.engine.start(seats2[0]!.id).ok).toBe(true);
    const order = [seats2[2]!.id, seats2[0]!.id, seats2[3]!.id, seats2[1]!.id];
    for (const pid of order) {
      expect(h.engine.setPlate(pid, writeFor(h.engine, pid, true)).ok).toBe(true);
      expect(h.engine.submitPlate(pid).ok).toBe(true);
      h.clock.advance(1000);
    }
    expect(h.engine.room.round!.turnOrder).toEqual(order);
  });

  it('(f) grid size = active players + 6 fillers, ids unique', () => {
    for (const n of [3, 5, 8]) {
      const { engine, seats } = startGame(20 + n, n);
      writeRound(engine, seats.map((s) => s.id), () => true);
      const grid = engine.room.round!.grid;
      expect(grid).toHaveLength(n + FILLER_CARDS_PER_ROUND);
      expect(new Set(grid.map((g) => g.card.id)).size).toBe(grid.length);
      expect(grid.filter((g) => g.ownerPlayerId === null)).toHaveLength(FILLER_CARDS_PER_ROUND);
    }
  });

  it('(g) tiebreak: equal totals resolved by Requirements count', () => {
    const { engine, seats } = startGame(30, 3);
    const [a, b, c] = seats.map((s) => s.id) as [string, string, string];
    const players = () => engine.room.players;
    // Hand-build piles: a and b both total 2, but a has more Requirements.
    players().find((p) => p.id === a)!.ownerPile = [OWNER_CARDS[0]!];
    players().find((p) => p.id === a)!.requirementsPile = [REQUIREMENT_CARDS[0]!];
    players().find((p) => p.id === b)!.ownerPile = [OWNER_CARDS[1]!, OWNER_CARDS[2]!];
    players().find((p) => p.id === c)!.ownerPile = [];
    expect(engine.forceEnd(a).ok).toBe(true);
    expect(engine.room.phase).toBe('GAME_OVER');
    expect(engine.room.winnerPlayerIds).toEqual([a]);
  });

  it('(g2) a full tie is a shared victory', () => {
    const { engine, seats } = startGame(31, 3);
    const ids = seats.map((s) => s.id);
    for (const [i, id] of ids.entries()) {
      const p = engine.room.players.find((x) => x.id === id)!;
      p.ownerPile = [OWNER_CARDS[i]!];
      p.requirementsPile = [REQUIREMENT_CARDS[i]!];
    }
    expect(engine.forceEnd(ids[0]!).ok).toBe(true);
    expect(engine.room.winnerPlayerIds.sort()).toEqual([...ids].sort());
  });
});

describe('writing phase', () => {
  it('rejects illegal plates server-side even though the tile picker cannot produce them', () => {
    const { engine, seats } = startGame(40, 3);
    const pid = seats[0]!.id;
    for (const bad of ['brf5', 'BRAF', 'BR F', 'BR-F', 'BCDFGHJKL']) {
      const res = engine.setPlate(pid, bad);
      expect(res.ok, `expected ${bad} to be rejected`).toBe(false);
    }
    expect(engine.room.round!.playerStates.find((s) => s.playerId === pid)!.plate).toBe('');
  });

  it('an empty auto-submitted plate is legal, scores no bonus, and can still be awarded', () => {
    const { engine, seats } = startGame(41, 3);
    const ids = seats.map((s) => s.id);
    // Only one player writes anything; the timer expires on the rest.
    expect(engine.setPlate(ids[0]!, writeFor(engine, ids[0]!, true)).ok).toBe(true);
    expect(engine.submitPlate(ids[0]!).ok).toBe(true);
    expect(engine.writeTimerExpired().ok).toBe(true);

    expect(engine.room.phase).toBe('GUESSING');
    const empties = engine.room.round!.playerStates.filter((s) => s.plate === '');
    expect(empties.length).toBe(2);
    for (const s of empties) expect(s.requirementsMet).toBe(false);

    // Walk the whole round; every player (empty plate or not) can be resolved.
    let guard = 0;
    while (engine.room.phase === 'GUESSING' && guard++ < 10) {
      const active = engine.activePlayerId()!;
      const st = engine.room.round!.playerStates.find((s) => s.playerId === active)!;
      const other = ids.find((i) => i !== active)!;
      // An empty plate realistically goes unguessed.
      const res = engine.award(active, st.plate === '' ? null : other);
      expect(res.ok, JSON.stringify(res)).toBe(true);
      if (st.plate === '') expect(engine.room.round!.currentResolution!.outcome).toBe('MISSED');
      expect(engine.advanceTurn(active).ok).toBe(true);
      checkInvariants(engine);
    }
    expect(engine.room.phase).toBe('ROUND_END');
  });

  it('a player cannot change their plate after submitting', () => {
    const { engine, seats } = startGame(42, 3);
    const pid = seats[0]!.id;
    expect(engine.setPlate(pid, 'BCDF').ok).toBe(true);
    expect(engine.submitPlate(pid).ok).toBe(true);
    expect(engine.setPlate(pid, 'GHJK').ok).toBe(false);
    expect(engine.submitPlate(pid).ok).toBe(false);
  });
});

describe('round & game flow', () => {
  it('runs exactly TOTAL_ROUNDS rounds and discards leftovers at round end', () => {
    const { engine, seats } = startGame(50, 4);
    const ids = seats.map((s) => s.id);
    for (let round = 1; round <= TOTAL_ROUNDS; round++) {
      expect(engine.room.round!.roundNumber).toBe(round);
      writeRound(engine, ids, () => true);
      while (engine.room.phase === 'GUESSING') {
        const active = engine.activePlayerId()!;
        expect(engine.award(active, null).ok).toBe(true);
        expect(engine.advanceTurn(active).ok).toBe(true);
      }
      // Everything left in the grid is discarded at the end of the round.
      expect(engine.room.round!.grid.every((g) => g.status !== 'IN_GRID')).toBe(true);
      if (round < TOTAL_ROUNDS) {
        expect(engine.room.phase).toBe('ROUND_END');
        expect(engine.nextRound(ids[0]!).ok).toBe(true);
      }
    }
    expect(engine.room.phase).toBe('GAME_OVER');
  });

  it('enforces MIN_PLAYERS / MAX_PLAYERS and host-only start', () => {
    const { engine } = makeEngine(60);
    const two = addPlayers(engine, 2);
    expect(engine.start(two[0]!.id).ok).toBe(false);
    const third = engine.join({ displayName: 'Third' });
    expect(third.ok).toBe(true);
    if (!third.ok) throw new Error('unreachable');
    expect(engine.start(third.player.id).ok).toBe(false); // not the host
    expect(engine.start(two[0]!.id).ok).toBe(true);
  });

  it('rejects duplicate display names case-insensitively and caps the room', () => {
    const { engine } = makeEngine(61);
    expect(engine.join({ displayName: 'Eric' }).ok).toBe(true);
    expect(engine.join({ displayName: 'eric' }).ok).toBe(false);
    for (let i = 0; i < 7; i++) expect(engine.join({ displayName: `X${i}` }).ok).toBe(true);
    expect(engine.join({ displayName: 'TooMany' }).ok).toBe(false);
  });

  it('a mid-game joiner is pending and becomes active next round', () => {
    const { engine, seats } = startGame(62, 3);
    const late = engine.join({ displayName: 'Late' });
    expect(late.ok).toBe(true);
    if (!late.ok) throw new Error('unreachable');
    expect(late.player.pendingJoin).toBe(true);
    expect(engine.room.round!.playerStates).toHaveLength(3);

    writeRound(engine, seats.map((s) => s.id), () => true);
    while (engine.room.phase === 'GUESSING') {
      const active = engine.activePlayerId()!;
      expect(engine.award(active, null).ok).toBe(true);
      expect(engine.advanceTurn(active).ok).toBe(true);
    }
    expect(engine.nextRound(seats[0]!.id).ok).toBe(true);
    expect(engine.room.round!.playerStates).toHaveLength(4);
    expect(engine.room.players.find((p) => p.id === late.player.id)!.pendingJoin).toBe(false);
  });

  it('reconnect by token reclaims the seat and resumes a paused game', () => {
    const { engine, seats } = startGame(63, 3);
    expect(engine.disconnect(seats[1]!.id).ok).toBe(true);
    expect(engine.room.phase).toBe('PAUSED');
    expect(engine.room.pause.waitingForPlayerId).toBe(seats[1]!.id);
    const back = engine.join({ displayName: 'P1', reconnectToken: seats[1]!.token });
    expect(back.ok).toBe(true);
    expect(engine.room.phase).toBe('WRITE_PLATES');
  });

  it('host transfers when the host disconnects', () => {
    const { engine, seats } = startGame(64, 3);
    expect(engine.disconnect(seats[0]!.id).ok).toBe(true);
    expect(engine.room.players.find((p) => p.id === seats[0]!.id)!.isHost).toBe(false);
    expect(engine.room.players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it('rematch clears piles and returns to LOBBY', () => {
    const { engine, seats } = startGame(65, 3);
    engine.room.players[0]!.ownerPile = [OWNER_CARDS[0]!];
    expect(engine.rematch(seats[0]!.id).ok).toBe(true);
    expect(engine.room.phase).toBe('LOBBY');
    expect(engine.room.round).toBeNull();
    for (const p of engine.room.players) {
      expect(p.ownerPile).toHaveLength(0);
      expect(p.requirementsPile).toHaveLength(0);
    }
  });

  it('never gates a phase transition on castConnected', () => {
    const { engine } = makeEngine(66);
    const seats = addPlayers(engine, 3, false);
    expect(engine.room.castConnected).toBe(false);
    expect(engine.start(seats[0]!.id).ok).toBe(true);
    expect(engine.room.phase).toBe('WRITE_PLATES');
  });
});

// ---------------------------------------------------------------------------
// Permanent deck-shape guard (acceptance criterion 6). A future deck edit
// cannot silently break the shipped decks.
// ---------------------------------------------------------------------------
describe('shipped decks', () => {
  it('Owner cards have unique ids and non-empty titles', () => {
    expect(OWNER_CARDS.length).toBeGreaterThan(0);
    expect(new Set(OWNER_CARDS.map((c) => c.id)).size).toBe(OWNER_CARDS.length);
    expect(new Set(OWNER_CARDS.map((c) => c.title.toLowerCase())).size).toBe(OWNER_CARDS.length);
    for (const c of OWNER_CARDS) {
      expect(c.id).toMatch(/^own_\d{3}$/);
      expect(c.title.trim().length).toBeGreaterThan(2);
    }
  });

  it('Requirements cards are exactly 3 legal symbols with unique ids', () => {
    expect(new Set(REQUIREMENT_CARDS.map((c) => c.id)).size).toBe(REQUIREMENT_CARDS.length);
    expect(new Set(REQUIREMENT_CARDS.map((c) => c.chars)).size).toBe(REQUIREMENT_CARDS.length);
    for (const c of REQUIREMENT_CARDS) {
      expect(c.id).toMatch(/^req_\d{2}$/);
      expect(c.chars).toHaveLength(3);
      for (const ch of c.chars) expect(PLATE_ALPHABET).toContain(ch);
      // Every requirement must be satisfiable inside an 8-char legal plate.
      expect(validatePlate(c.chars).ok).toBe(true);
    }
  });

  it('ships exactly 36 Requirements cards', () => {
    expect(REQUIREMENT_CARDS).toHaveLength(36);
  });

  it('ships exactly 200 Owner cards', () => {
    expect(OWNER_CARDS).toHaveLength(200);
  });
});
