import { useEffect, useRef, useState } from 'react';
import type { PublicPlayer } from '@vntypl8s/shared';
import { useGame } from './useGame.js';
import { sound } from './sound.js';

/** Live clock for countdowns. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** `tick` opts into a countdown-beep for the last 5 seconds — only worth
 * enabling on a timer whose expiry actually ends the current action. */
export function Timer({
  deadline,
  className = '',
  tick = false,
}: {
  deadline: number | null;
  className?: string;
  tick?: boolean;
}) {
  const now = useNow();
  const { serverOffset } = useGame();
  const lastTicked = useRef<number | null>(null);
  const remaining = deadline === null ? null : Math.ceil((deadline - (now - serverOffset)) / 1000);

  useEffect(() => {
    if (!tick || remaining === null) return;
    if (remaining > 0 && remaining <= 5 && lastTicked.current !== remaining) {
      lastTicked.current = remaining;
      // The final three seconds get the sharper countdown blip; 5s and 4s
      // keep the softer tick so the escalation is audible.
      sound.playSfx(remaining <= 3 ? 'countdown' : 'timer-tick');
    }
  }, [tick, remaining]);

  if (deadline === null || remaining === null) return null;
  const cls = remaining <= 0 ? 'over' : remaining <= 15 ? 'warn' : '';
  return (
    <span className={`timer ${cls} ${className}`}>{remaining <= 0 ? '0s' : `${remaining}s`}</span>
  );
}

export function ScoreChip({ player }: { player: PublicPlayer }) {
  return (
    <span className="scorechip" title="Owner cards + Requirements cards">
      <b>{player.totalScore}</b>
      <span className="muted small">
        {player.ownerScore}o · {player.requirementsScore}r
      </span>
    </span>
  );
}

/** A plate rendered as an actual licence plate. `size` scales it. */
export function PlateDisplay({
  plate,
  slots,
  size = 'md',
}: {
  plate: string;
  /** Show empty slot boxes up to this many characters. */
  slots?: number;
  size?: 'sm' | 'md' | 'lg' | 'tv';
}) {
  const chars = [...plate];
  const total = slots ?? chars.length;
  const cells = Array.from({ length: Math.max(total, chars.length) }, (_, i) => chars[i] ?? null);
  return (
    <div className={`plate plate-${size}`} aria-label={plate ? `Plate ${plate}` : 'Empty plate'}>
      <div className="plate-inner">
        {cells.length === 0 ? (
          <span className="plate-char empty" />
        ) : (
          cells.map((c, i) => (
            <span key={i} className={`plate-char${c === null ? ' empty' : ''}`}>
              {c ?? ''}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/** Small fixed-position toggle for the SFX/voice-line sound effects. Muting
 * is a per-device preference (localStorage), not game state. */
export function MuteButton() {
  const [muted, setMuted] = useState(sound.isMuted());
  useEffect(() => sound.subscribe(() => setMuted(sound.isMuted())), []);
  return (
    <button
      className="ghost mutebtn"
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      onClick={() => sound.toggleMuted()}
    >
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

export function PlayerChip({
  player,
  you,
  active,
}: {
  player: PublicPlayer;
  you?: boolean;
  active?: boolean;
}) {
  return (
    <span className={`pchip${active ? ' active' : ''}${player.connected ? '' : ' offline'}`}>
      {player.displayName}
      {player.isHost ? ' 👑' : ''}
      {you ? ' (you)' : ''}
      {player.pendingJoin ? ' ⏳' : ''}
    </span>
  );
}
