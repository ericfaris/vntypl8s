import { describe, expect, it } from 'vitest';
import { TOTAL_ROUNDS } from '@vntypl8s/shared';
import { addPlayers, checkInvariants, makeEngine, playFullGame } from './harness.js';
import { makeRng } from '../rng.js';

describe('full-game simulations across many instances', () => {
  for (const playerCount of [3, 4, 5, 6, 7, 8]) {
    it(`plays 25 seeded 3-round games with ${playerCount} players`, () => {
      for (let seed = 0; seed < 25; seed++) {
        const { engine } = makeEngine(seed * 100 + playerCount);
        const seats = addPlayers(engine, playerCount);
        const host = seats[0]!;
        const r = engine.start(host.id);
        expect(r.ok, JSON.stringify(r)).toBe(true);
        checkInvariants(engine);

        const g = makeRng(seed * 7 + 1);
        const rounds = playFullGame(engine, host.id, {
          rng: () => g.next(),
          guessProb: 0.55,
          meetReqProb: 0.5,
        });

        expect(rounds).toBe(TOTAL_ROUNDS);
        expect(engine.room.phase).toBe('GAME_OVER');
        expect(engine.room.round!.roundNumber).toBe(TOTAL_ROUNDS);

        // A valid terminal state: at least one winner, and every winner holds
        // the maximum total score.
        const winners = engine.room.winnerPlayerIds;
        expect(winners.length).toBeGreaterThanOrEqual(1);
        const totals = engine.room.players.map(
          (p) => p.ownerPile.length + p.requirementsPile.length,
        );
        const max = Math.max(...totals);
        for (const id of winners) {
          const p = engine.room.players.find((x) => x.id === id)!;
          expect(p.ownerPile.length + p.requirementsPile.length).toBe(max);
        }

        // Conservation: every Owner card scored across the game came out of a
        // grid, and no player scored more Owner cards than turns were played.
        const totalOwnerScored = engine.room.players.reduce((n, p) => n + p.ownerPile.length, 0);
        expect(totalOwnerScored).toBeLessThanOrEqual(playerCount * TOTAL_ROUNDS);

        checkInvariants(engine);
      }
    });
  }

  it('extremes (everyone guessed / nobody guessed) still terminate cleanly', () => {
    for (const guessProb of [0, 1]) {
      for (const meetReqProb of [0, 1]) {
        for (const playerCount of [3, 5, 8]) {
          const { engine } = makeEngine(guessProb * 1000 + meetReqProb * 100 + playerCount);
          const seats = addPlayers(engine, playerCount);
          expect(engine.start(seats[0]!.id).ok).toBe(true);
          const g = makeRng(99);
          const rounds = playFullGame(engine, seats[0]!.id, {
            rng: () => g.next(),
            guessProb,
            meetReqProb,
          });
          expect(rounds).toBe(TOTAL_ROUNDS);
          expect(engine.room.phase).toBe('GAME_OVER');
          if (guessProb === 0) {
            // Nobody ever guessed: no Owner cards and no Requirements bonuses.
            for (const p of engine.room.players) {
              expect(p.ownerPile).toHaveLength(0);
              expect(p.requirementsPile).toHaveLength(0);
            }
            expect(engine.room.winnerPlayerIds.length).toBe(playerCount);
          }
          if (guessProb === 1 && meetReqProb === 1) {
            // Everyone always met their requirements and was always guessed:
            // every player banks a Requirements card every round.
            for (const p of engine.room.players) {
              expect(p.requirementsPile).toHaveLength(TOTAL_ROUNDS);
            }
          }
        }
      }
    }
  });
});
