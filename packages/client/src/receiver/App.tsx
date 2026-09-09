import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import type { PublicRoom, PublicTurnResolution } from '@vntypl8s/shared';
import { useGame } from '../common/useGame.js';
import { getDebugEntries, isDebugOn, onDebugToggle, subscribeDebug } from './debug.js';

const nameOf = (pub: PublicRoom, id: string | null) =>
  pub.players.find((p) => p.id === id)?.displayName ?? '???';

/** Corner tag so a host can see which build the TV is running. */
function VersionTag({ version }: { version: string }) {
  if (!version) return null;
  return <div className="tv-version">v{version}</div>;
}

function DebugOverlay() {
  const [, force] = useState(0);
  const [on, setOn] = useState(isDebugOn());
  useEffect(() => subscribeDebug(() => force((n) => n + 1)), []);
  useEffect(() => onDebugToggle(() => setOn(isDebugOn())), []);
  if (!on) return null;
  const entries = getDebugEntries().slice(-40);
  return (
    <div className="tv-debug">
      {entries.map((e, i) => (
        <div key={i} className={`tv-debug-line ${e.level}`}>
          {new Date(e.t).toISOString().slice(11, 19)} {e.text}
        </div>
      ))}
    </div>
  );
}

/** Countdown against a server deadline, reconciled for clock skew. */
function TvTimer({ deadline, offset }: { deadline: number | null; offset: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  if (deadline === null) return null;
  const remaining = Math.max(0, Math.ceil((deadline - (now - offset)) / 1000));
  return (
    <span className={`tv-timer${remaining <= 15 ? ' warn' : ''}`}>{remaining}s</span>
  );
}

function TvPlate({ plate }: { plate: string }) {
  return (
    <div className="tv-plate">
      <div className="tv-plate-inner">
        {[...plate].map((c, i) => (
          <span key={i} className="tv-plate-char">
            {c}
          </span>
        ))}
        {plate.length === 0 && <span className="tv-plate-char dim">—</span>}
      </div>
    </div>
  );
}

function Scoreboard({ pub }: { pub: PublicRoom }) {
  const sorted = [...pub.players]
    .filter((p) => !p.pendingJoin)
    .sort((a, b) => b.totalScore - a.totalScore || b.requirementsScore - a.requirementsScore);
  return (
    <div className="tv-scores">
      {sorted.map((p) => (
        <div
          key={p.id}
          className={`tv-score${pub.round?.activePlayerId === p.id ? ' active' : ''}`}
        >
          <span className="tv-score-name">{p.displayName}</span>
          <span className="tv-score-total">{p.totalScore}</span>
          <span className="tv-score-sub">
            {p.ownerScore} owner · {p.requirementsScore} req
          </span>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const g = useGame();
  const [baseUrl, setBaseUrl] = useState(() => window.location.origin);
  const [appVersion, setAppVersion] = useState('');
  /** Playwright/visual-regression hook — see window.__vpSetState below. */
  const [override, setOverride] = useState<PublicRoom | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((c) => {
        if (c.publicBaseUrl) setBaseUrl(c.publicBaseUrl);
        if (c.appVersion) setAppVersion(c.appVersion);
      })
      .catch(() => undefined);
  }, []);

  // Drive the receiver's rendering directly from a script (guide §6): a
  // Playwright pass can stub CAF and call window.__vpSetState(mockState) for
  // a battery of hand-authored screens with zero network involvement.
  useEffect(() => {
    (window as unknown as { __vpSetState?: (s: PublicRoom | null) => void }).__vpSetState = (s) =>
      setOverride(s);
  }, []);

  const pub = override ?? g.pub;

  let content: ReactNode;
  if (!pub) {
    const castError = (window as unknown as { __castInitError?: string | null }).__castInitError;
    content = (
      <div className="tv tv-center tv-lobby-bg">
        <img className="tv-logo" src="/brand/logo.png" alt="VNTYPL8S" />
        <div className="tv-muted">Waiting for a room…</div>
        {castError && <div className="tv-error">Cast init error: {castError}</div>}
      </div>
    );
  } else if (pub.phase === 'LOBBY') {
    content = <LobbyTV pub={pub} baseUrl={baseUrl} />;
  } else if (pub.phase === 'WRITE_PLATES') {
    content = <WriteTV pub={pub} offset={g.serverOffset} />;
  } else if (pub.phase === 'GUESSING') {
    content = <GuessingTV pub={pub} />;
  } else if (pub.phase === 'ROUND_END') {
    content = <RoundEndTV pub={pub} />;
  } else if (pub.phase === 'GAME_OVER') {
    content = <GameOverTV pub={pub} />;
  } else {
    content = <PausedTV pub={pub} />;
  }

  return (
    <>
      {content}
      <VersionTag version={appVersion} />
      <DebugOverlay />
    </>
  );
}

function LobbyTV({ pub, baseUrl }: { pub: PublicRoom; baseUrl: string }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    const url = `${baseUrl}/?code=${pub.code}`;
    QRCode.toDataURL(url, { width: 400, margin: 1 })
      .then(setQr)
      .catch(() => undefined);
  }, [baseUrl, pub.code]);

  return (
    <div className="tv tv-lobby-bg">
      <img className="tv-logo" src="/brand/logo.png" alt="VNTYPL8S" />
      <div className="tv-spread tv-grow">
        <div className="tv-stack tv-center-text">
          <div className="tv-muted tv-join">
            Join at <b>{baseUrl.replace(/^https?:\/\//, '')}</b>
          </div>
          <div className="tv-code">{pub.code}</div>
          <div className="tv-muted">
            {pub.players.filter((p) => !p.pendingJoin).length} in the lobby
          </div>
        </div>
        {qr && (
          <div className="tv-qr">
            <img src={qr} alt="Join QR" />
          </div>
        )}
      </div>
      <div className="tv-players">
        {pub.players.map((p) => (
          <div key={p.id} className="tv-pchip">
            {p.displayName}
            {p.isHost ? ' 👑' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

function WriteTV({ pub, offset }: { pub: PublicRoom; offset: number }) {
  const players = pub.players.filter((p) => !p.pendingJoin);
  return (
    <div className="tv">
      <div className="tv-spread">
        <div className="tv-brand">
          Round {pub.round?.roundNumber ?? 1} of {pub.totalRounds} · Writing plates
        </div>
        <TvTimer deadline={pub.timer.phaseDeadline} offset={offset} />
      </div>
      <div className="tv-writegrid tv-grow">
        {players.map((p) => (
          <div key={p.id} className={`tv-writerow${p.submitted ? ' done' : ''}`}>
            <span className="tv-writename">{p.displayName}</span>
            <span className="tv-dots">
              {/* Length only — the projection deliberately never carries the
                  draft text itself. */}
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className={`tv-dot${i < p.plateLength ? ' on' : ''}`} />
              ))}
            </span>
            <span className="tv-writestatus">{p.submitted ? '✓ locked in' : 'writing…'}</span>
          </div>
        ))}
      </div>
      <Scoreboard pub={pub} />
    </div>
  );
}

function ResolutionBanner({ pub, res }: { pub: PublicRoom; res: PublicTurnResolution }) {
  return (
    <div className="tv-reveal">
      <div className="tv-reveal-title">
        {res.outcome === 'GUESSED'
          ? `${nameOf(pub, res.winnerPlayerId)} got it!`
          : 'Nobody got it'}
      </div>
      <div className="tv-reveal-card">{res.ownerCardTitle}</div>
      <div className="tv-reveal-sub">
        Requirements {res.requirementsChars} —{' '}
        {res.requirementsScored
          ? 'bonus scored ✓'
          : res.requirementsMet
            ? 'met, but unguessed'
            : 'not met'}
      </div>
    </div>
  );
}

function GuessingTV({ pub }: { pub: PublicRoom }) {
  const round = pub.round!;
  return (
    <div className="tv">
      <div className="tv-spread">
        <div className="tv-brand">
          Round {round.roundNumber} of {pub.totalRounds} · Plate {round.turnIndex + 1} of{' '}
          {round.turnOrder.length}
        </div>
        <div className="tv-brand">{nameOf(pub, round.activePlayerId)}</div>
      </div>

      <div className="tv-center-block">
        <TvPlate plate={round.revealedPlate ?? ''} />
      </div>

      {round.currentResolution ? (
        <ResolutionBanner pub={pub} res={round.currentResolution} />
      ) : (
        <div className="tv-prompt">Call out your guess — one each!</div>
      )}

      <div className="tv-grid tv-grow">
        {round.grid.map((c) => (
          <div key={c.cardId} className={`tv-card ${c.status.toLowerCase()}`}>
            {c.title}
          </div>
        ))}
      </div>

      <Scoreboard pub={pub} />
    </div>
  );
}

function RoundEndTV({ pub }: { pub: PublicRoom }) {
  const round = pub.round!;
  return (
    <div className="tv">
      <div className="tv-brand">
        End of round {round.roundNumber} of {pub.totalRounds}
      </div>
      <div className="tv-recap tv-grow">
        {round.resolutions.map((r, i) => (
          <div key={i} className="tv-recaprow">
            <span className="tv-recapname">{nameOf(pub, r.activePlayerId)}</span>
            <span className="tv-recapcard">{r.ownerCardTitle}</span>
            <span className="tv-recapwho">
              {r.outcome === 'GUESSED' ? `→ ${nameOf(pub, r.winnerPlayerId)}` : '→ discarded'}
              {r.requirementsScored ? ' +bonus' : ''}
            </span>
          </div>
        ))}
      </div>
      <Scoreboard pub={pub} />
    </div>
  );
}

function GameOverTV({ pub }: { pub: PublicRoom }) {
  const winners = pub.winnerPlayerIds.map((id) => nameOf(pub, id));
  return (
    <div className="tv tv-center tv-gameover-bg">
      <div className="tv-brand">Final</div>
      <div className="tv-code">
        {winners.length === 0
          ? 'No winner'
          : winners.length > 1
            ? `${winners.join(' & ')}`
            : winners[0]}
      </div>
      <div className="tv-muted">
        {winners.length > 1 ? 'Shared victory' : winners.length === 1 ? 'wins!' : ''}
      </div>
      <Scoreboard pub={pub} />
    </div>
  );
}

function PausedTV({ pub }: { pub: PublicRoom }) {
  return (
    <div className="tv tv-center">
      <div className="tv-code">⏸</div>
      <div className="tv-brand">
        {pub.pause.waitingForPlayerId
          ? `Waiting for ${nameOf(pub, pub.pause.waitingForPlayerId)}…`
          : 'Paused'}
      </div>
    </div>
  );
}
