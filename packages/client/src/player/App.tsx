import { useCallback, useEffect, useState } from 'react';
import { useGame } from '../common/useGame.js';
import { store } from '../common/store.js';
import { useWakeLock } from '../common/useWakeLock.js';
import { CastProvider, useCast } from '../common/cast/CastProvider.js';
import { MuteButton } from '../common/ui.js';
import { AlienSticker, PawSticker } from '../common/stickers.js';
import { GameOver, Guessing, Lobby, Paused, RoundEnd, WritePlates } from './screens.js';

type View = 'landing' | 'host' | 'join';

interface Config {
  castReceiverAppId: string;
  publicBaseUrl: string;
  appVersion: string;
}

/** Corner tag so a host can tell at a glance which build is live — deploys
 *  wipe in-memory rooms with no other visible record. */
function VersionTag({ version }: { version?: string }) {
  if (!version) return null;
  return (
    <div
      className="muted"
      style={{ position: 'fixed', bottom: 6, right: 10, fontSize: '0.7rem', opacity: 0.6 }}
    >
      v{version}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="banner spread">
      <span>{message}</span>
      <button className="ghost small" onClick={() => store.setError(null)}>
        ✕
      </button>
    </div>
  );
}

export default function App() {
  const g = useGame();
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then(setConfig)
      .catch(() =>
        setConfig({
          castReceiverAppId: '',
          publicBaseUrl: window.location.origin,
          appVersion: '',
        }),
      );
  }, []);

  const onCastStateChange = useCallback((connected: boolean) => store.castStatus(connected), []);

  return (
    <CastProvider
      appId={config?.castReceiverAppId ?? ''}
      roomCode={g.code}
      apiBaseUrl={config?.publicBaseUrl ?? window.location.origin}
      onStateChange={onCastStateChange}
    >
      <Shell config={config} />
    </CastProvider>
  );
}

function Shell({ config }: { config: Config | null }) {
  const g = useGame();
  const [view, setView] = useState<View>('landing');

  // deep-link join: /join?code=1234 or ?code=1234
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('code')) setView('join');
  }, []);

  const joined = !!g.priv?.playerId && !!g.pub;

  if (joined) {
    return (
      <>
        <InGame />
        <VersionTag version={config?.appVersion} />
      </>
    );
  }

  return (
    <div className="app center">
      <MuteButton />
      <div className="stack" style={{ width: '100%' }}>
        <div className="center-text stack stickerfield">
          <AlienSticker className="tl" />
          <PawSticker className="tr" />
          <img className="brand-logo" src="/brand/logo.png" alt="VNTYPL8S" />
          <div className="muted">Party game · phones + your TV</div>
        </div>
        {g.error && <ErrorBanner message={g.error} />}
        {view === 'landing' && (
          <Landing onHost={() => setView('host')} onJoin={() => setView('join')} />
        )}
        {view === 'host' && <HostFlow onBack={() => setView('landing')} />}
        {view === 'join' && <JoinFlow onBack={() => setView('landing')} />}
      </div>
      <VersionTag version={config?.appVersion} />
    </div>
  );
}

function Landing({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return (
    <div className="card stack">
      <button className="primary" onClick={onHost}>
        📺 Host a game
      </button>
      <button onClick={onJoin}>🎮 Join a game</button>
    </div>
  );
}

function HostFlow({ onBack }: { onBack: () => void }) {
  const g = useGame();
  const cast = useCast();
  const [name, setName] = useState(store.savedName() ?? '');
  const [busy, setBusy] = useState(false);
  const code = g.code;

  // Cast is entirely optional — creating a room never waits on it.
  async function create() {
    setBusy(true);
    await store.hostCreate(cast.state !== 'unavailable');
    setBusy(false);
  }

  if (!code) {
    return (
      <div className="card stack">
        <div className="h2">Host a game</div>
        <div className="muted small">
          You&apos;ll get a 4-digit code for everyone else to join with.
        </div>
        <button className="primary" disabled={busy} onClick={create}>
          {busy ? 'Creating…' : 'Create room'}
        </button>
        <button className="ghost small" onClick={onBack}>
          ← Back
        </button>
      </div>
    );
  }

  return (
    <div className="card stack">
      <div className="h2">Room {code}</div>
      {cast.state !== 'unavailable' && (
        <button onClick={cast.requestSession}>
          {cast.state === 'connected'
            ? cast.synced
              ? '📺 TV connected'
              : '📺 Connecting TV…'
            : '📺 Cast to a TV'}
        </button>
      )}
      {cast.receiverDevUrl ? (
        <a
          className="notice small"
          href={cast.receiverDevUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          ⧉ Open the TV view in a browser tab (dev preview)
        </a>
      ) : (
        <div className="notice small muted">
          No Chromecast? Open <code>/receiver.html?dev</code> on any screen once a room is up.
        </div>
      )}
      <input
        value={name}
        placeholder="Your name"
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && name.trim() && store.join(code, name.trim(), true)}
      />
      <button
        className="primary"
        disabled={!name.trim()}
        onClick={() => void store.join(code, name.trim(), true)}
      >
        Enter lobby
      </button>
    </div>
  );
}

function JoinFlow({ onBack }: { onBack: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const [code, setCode] = useState(params.get('code') ?? '');
  const [name, setName] = useState(store.savedName() ?? '');
  const [busy, setBusy] = useState(false);

  async function join() {
    setBusy(true);
    const ok = await store.join(code.trim(), name.trim());
    if (!ok) setBusy(false);
  }

  return (
    <div className="card stack">
      <div className="h2">Join a game</div>
      <label className="stack small">
        <span className="muted">Room code</span>
        <input
          value={code}
          inputMode="numeric"
          maxLength={4}
          placeholder="4-digit code"
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
      </label>
      <label className="stack small">
        <span className="muted">Your name</span>
        <input value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
      </label>
      <button className="primary" disabled={busy || code.length !== 4 || !name.trim()} onClick={join}>
        Join
      </button>
      <button className="ghost small" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- In-game
function InGame() {
  const g = useGame();
  const cast = useCast();
  const pub = g.pub!;
  const priv = g.priv!;

  // Long stretches with no touches (composing, then guessing out loud) —
  // keep the player's screen from auto-locking.
  useWakeLock(true);

  return (
    <div className="app stack">
      <MuteButton />
      {!g.connected && <div className="banner">Reconnecting…</div>}
      {g.error && <ErrorBanner message={g.error} />}
      {pub.phase === 'LOBBY' && (
        <Lobby
          pub={pub}
          priv={priv}
          castState={cast.state}
          onCast={cast.requestSession}
          devUrl={cast.receiverDevUrl}
        />
      )}
      {pub.phase === 'WRITE_PLATES' && <WritePlates pub={pub} priv={priv} />}
      {pub.phase === 'GUESSING' && <Guessing pub={pub} priv={priv} />}
      {pub.phase === 'ROUND_END' && <RoundEnd pub={pub} priv={priv} />}
      {pub.phase === 'GAME_OVER' && <GameOver pub={pub} priv={priv} />}
      {pub.phase === 'PAUSED' && <Paused pub={pub} />}
    </div>
  );
}
