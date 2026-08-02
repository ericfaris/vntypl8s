import { useEffect, useState } from 'react';
import type { PublicPlayer } from '@vntypl8s/shared';
import { useGame } from './useGame.js';

/** Live clock for countdowns. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function Timer({ deadline, className = '' }: { deadline: number | null; className?: string }) {
  const now = useNow();
  const { serverOffset } = useGame();
  if (deadline === null) return null;
  // deadline is a server epoch; reconcile against client clock skew.
  const remaining = Math.ceil((deadline - (now - serverOffset)) / 1000);
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
