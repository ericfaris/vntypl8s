import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type PrivateState,
  type PublicPlayer,
  type PublicRoom,
} from '@vntypl8s/shared';
import { store } from '../common/store.js';
import { PlateDisplay, PlayerChip, ScoreChip, Timer } from '../common/ui.js';
import { PlateWriter } from './PlateWriter.js';

const nameOf = (pub: PublicRoom, id: string | null) =>
  pub.players.find((p) => p.id === id)?.displayName ?? '???';

function Standings({ pub }: { pub: PublicRoom }) {
  const sorted = [...pub.players]
    .filter((p) => !p.pendingJoin)
    .sort((a, b) => b.totalScore - a.totalScore || b.requirementsScore - a.requirementsScore);
  return (
    <div className="standings">
      {sorted.map((p) => (
        <div key={p.id} className={`standing${pub.winnerPlayerIds.includes(p.id) ? ' winner' : ''}`}>
          <span>
            {p.displayName}
            {pub.winnerPlayerIds.includes(p.id) ? ' 🏆' : ''}
          </span>
          <ScoreChip player={p} />
        </div>
      ))}
    </div>
  );
}

// --------------------------------------------------------------------- Lobby
export function Lobby({
  pub,
  priv,
  castState,
  onCast,
}: {
  pub: PublicRoom;
  priv: PrivateState;
  /** From the Cast controller. 'unavailable' hides the button entirely. */
  castState?: string;
  onCast?: () => void;
}) {
  const active = pub.players.filter((p) => !p.pendingJoin && p.connected);
  const canStart = active.length >= MIN_PLAYERS && active.length <= MAX_PLAYERS;
  return (
    <div className="stack">
      <div className="card stack center-text">
        <div className="muted small">Room code</div>
        <div className="code-big">{pub.code}</div>
      </div>

      <div className="card stack">
        <div className="h2">
          Players ({active.length}/{MAX_PLAYERS})
        </div>
        <div className="row wrap">
          {pub.players.map((p) => (
            <PlayerChip key={p.id} player={p} you={p.id === priv.playerId} />
          ))}
        </div>
        <div className="muted small">
          Need {MIN_PLAYERS}–{MAX_PLAYERS} players to start.
        </div>
      </div>

      {priv.isHost && (
        <>
          {castState && castState !== 'unavailable' && onCast && (
            <button onClick={onCast}>
              {castState === 'connected' ? '📺 Casting — change TV' : '📺 Cast to a TV'}
            </button>
          )}
          <button className="primary" disabled={!canStart} onClick={() => void store.start()}>
            Start game
          </button>
        </>
      )}
      {!priv.isHost && <div className="muted center-text">Waiting for the host to start…</div>}
    </div>
  );
}

// -------------------------------------------------------------- WritePlates
export function WritePlates({ pub, priv }: { pub: PublicRoom; priv: PrivateState }) {
  const waiting = pub.players.filter((p) => !p.pendingJoin && !p.submitted);

  return (
    <div className="stack">
      <div className="spread">
        <span className="muted small">
          Round {pub.round?.roundNumber ?? 1} of {pub.totalRounds} · Writing
        </span>
        {pub.timer.enabled && <Timer deadline={pub.timer.phaseDeadline} />}
      </div>

      {priv.pendingJoin ? (
        <div className="card center-text muted">
          You joined mid-game — you&apos;re in from the next round.
        </div>
      ) : priv.submitted ? (
        <div className="card stack center-text">
          <div className="h2">Plate locked in</div>
          <PlateDisplay plate={priv.plate} size="md" />
          <div className={priv.requirementsMet ? 'met' : 'notmet'}>
            {priv.requirementsMet
              ? '✓ Requirements met — bonus card if someone guesses you'
              : 'Requirements not met — no bonus this round'}
          </div>
          <div className="muted">
            Waiting for {waiting.length} more player{waiting.length === 1 ? '' : 's'}…
          </div>
          <div className="row wrap" style={{ justifyContent: 'center' }}>
            {waiting.map((p) => (
              <PlayerChip key={p.id} player={p} />
            ))}
          </div>
        </div>
      ) : (
        <PlateWriter priv={priv} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Guessing
export function Guessing({ pub, priv }: { pub: PublicRoom; priv: PrivateState }) {
  const round = pub.round;
  if (!round) return null;
  const activeId = round.activePlayerId;
  const isActive = priv.isActivePlayer;
  const resolution = round.currentResolution;

  return (
    <div className="stack">
      <div className="spread">
        <span className="muted small">
          Round {round.roundNumber} of {pub.totalRounds} · Plate {round.turnIndex + 1} of{' '}
          {round.turnOrder.length}
        </span>
      </div>

      <div className="card stack center-text">
        <div className="muted small">{isActive ? 'Your plate' : `${nameOf(pub, activeId)}'s plate`}</div>
        <PlateDisplay plate={round.revealedPlate ?? ''} size="lg" />
      </div>

      {isActive ? (
        resolution ? (
          <div className="card stack">
            <div className="h2">
              {resolution.outcome === 'GUESSED'
                ? `${nameOf(pub, resolution.winnerPlayerId)} got it!`
                : 'Nobody got it.'}
            </div>
            <div className="ownercard">
              <div className="label">Your Owner card was</div>
              <div className="value">{resolution.ownerCardTitle}</div>
            </div>
            <div className="spread">
              <span className="reqcard">
                {[...resolution.requirementsChars].map((c, i) => (
                  <span key={i} className="reqchar">
                    {c}
                  </span>
                ))}
              </span>
              <span className={resolution.requirementsScored ? 'met' : 'notmet'}>
                {resolution.requirementsScored
                  ? '✓ Bonus card scored'
                  : resolution.requirementsMet
                    ? 'Met, but nobody guessed — no bonus'
                    : 'Requirements not met — no bonus'}
              </span>
            </div>
            <button className="primary" onClick={() => void store.advance()}>
              Next plate →
            </button>
          </div>
        ) : (
          <div className="card stack">
            <div className="h2">Who guessed it?</div>
            <div className="muted small">
              Everyone guesses out loud. Tap whoever got it first.
            </div>
            <div className="awardlist">
              {pub.players
                .filter((p) => p.id !== priv.playerId && !p.pendingJoin && p.connected)
                .map((p) => (
                  <button key={p.id} onClick={() => void store.award(p.id)}>
                    {p.displayName}
                  </button>
                ))}
              <button className="ghost" onClick={() => void store.award(null)}>
                Nobody got it
              </button>
            </div>
          </div>
        )
      ) : (
        <div className="card stack center-text">
          {resolution ? (
            <>
              <div className="h2">
                {resolution.outcome === 'GUESSED'
                  ? `${nameOf(pub, resolution.winnerPlayerId)} got it`
                  : 'Nobody got it'}
              </div>
              <div className="muted">It was “{resolution.ownerCardTitle}”.</div>
            </>
          ) : (
            <>
              <div className="h2">Say your guess out loud</div>
              <div className="muted small">
                One guess each per plate. {nameOf(pub, activeId)} decides who got it.
              </div>
            </>
          )}
        </div>
      )}

      <div className="card stack">
        <div className="h2">Scores</div>
        <Standings pub={pub} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ RoundEnd
export function RoundEnd({ pub, priv }: { pub: PublicRoom; priv: PrivateState }) {
  return (
    <div className="stack">
      <div className="card stack center-text">
        <div className="h2">
          End of round {pub.round?.roundNumber ?? 1} of {pub.totalRounds}
        </div>
      </div>
      <div className="card stack">
        <div className="h2">Scores</div>
        <Standings pub={pub} />
      </div>
      {priv.isHost ? (
        <button className="primary" onClick={() => void store.nextRound()}>
          Next round →
        </button>
      ) : (
        <div className="muted center-text">Waiting for the host…</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ GameOver
export function GameOver({ pub, priv }: { pub: PublicRoom; priv: PrivateState }) {
  const winners = pub.winnerPlayerIds.map((id) => nameOf(pub, id));
  const shared = winners.length > 1;
  return (
    <div className="stack">
      <div className="card stack center-text">
        <div className="title">GAME OVER</div>
        <div className="h2">
          {winners.length === 0
            ? 'No winner'
            : shared
              ? `Shared victory: ${winners.join(' & ')}`
              : `${winners[0]} wins!`}
        </div>
      </div>
      <div className="card stack">
        <div className="h2">Final standings</div>
        <Standings pub={pub} />
      </div>
      <div className="card stack">
        <div className="h2">Your pile</div>
        <div className="muted small">
          {priv.ownerPile.length} Owner · {priv.requirementsPile.length} Requirements
        </div>
        <div className="row wrap">
          {priv.ownerPile.map((c) => (
            <span key={c.id} className="pchip">
              {c.title}
            </span>
          ))}
          {priv.requirementsPile.map((c) => (
            <span key={c.id} className="pchip">
              {c.chars}
            </span>
          ))}
        </div>
      </div>
      {priv.isHost && (
        <button className="primary" onClick={() => void store.rematch()}>
          New game
        </button>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- Paused
export function Paused({ pub }: { pub: PublicRoom }) {
  const who: PublicPlayer | undefined = pub.players.find(
    (p) => p.id === pub.pause.waitingForPlayerId,
  );
  return (
    <div className="card stack center-text">
      <div className="title">⏸</div>
      <div className="h2">Paused</div>
      <div className="muted">
        {who ? `Waiting for ${who.displayName} to reconnect…` : 'Waiting for a player…'}
      </div>
    </div>
  );
}
