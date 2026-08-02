// UI-level guards for the two rules the plan says the interface itself must
// enforce:
//   - the tile picker is the ONLY plate input, so illegal characters are
//     structurally unrepresentable (no <input>, no vowels, no punctuation)
//   - guessing is verbal: only the Active Player gets award buttons, and
//     never one for themselves
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PLATE_MAX_LENGTH, VOWELS } from '@vntypl8s/shared';

// screens.tsx imports the socket-backed `store` singleton, which opens a real
// socket.io connection on module load. Stub it out.
vi.mock('socket.io-client', () => ({
  io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }),
}));

const { WritePlates, Guessing, Lobby, GameOver, RoundEnd, Paused } = await import('../screens.js');
const { makePub, makePriv, makeRound, makePlayer, guessingFixture } = await import(
  '../../test/fixtures.js'
);

describe('PlateWriter — the tile picker is the enforcement mechanism', () => {
  it('renders no text input or contentEditable anywhere', () => {
    const { container } = render(<WritePlates pub={makePub()} priv={makePriv()} />);
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[contenteditable]')).toBeNull();
  });

  it('offers no vowel tiles', () => {
    render(<WritePlates pub={makePub()} priv={makePriv()} />);
    for (const v of VOWELS) {
      expect(screen.queryByRole('button', { name: `Add ${v}` })).toBeNull();
    }
  });

  it('offers exactly 31 legal tiles: 21 letters (incl. Y) + 10 digits', () => {
    render(<WritePlates pub={makePub()} priv={makePriv()} />);
    const tiles = screen.getAllByRole('button', { name: /^Add / });
    expect(tiles).toHaveLength(31);
    expect(screen.getByRole('button', { name: 'Add Y' })).toBeInTheDocument();
    for (const d of '0123456789') {
      expect(screen.getByRole('button', { name: `Add ${d}` })).toBeInTheDocument();
    }
  });

  it('offers no punctuation, space or lowercase tile', () => {
    render(<WritePlates pub={makePub()} priv={makePriv()} />);
    const labels = screen
      .getAllByRole('button', { name: /^Add / })
      .map((b) => b.getAttribute('aria-label')!.replace('Add ', ''));
    for (const l of labels) expect(l).toMatch(/^[A-Z0-9]$/);
  });

  it('disables every tile once the plate is full', () => {
    const priv = makePriv({ plate: 'B'.repeat(PLATE_MAX_LENGTH) });
    render(<WritePlates pub={makePub()} priv={priv} />);
    for (const tile of screen.getAllByRole('button', { name: /^Add / })) {
      expect(tile).toBeDisabled();
    }
  });

  it('restates the honour-system rule instead of enforcing it', () => {
    render(<WritePlates pub={makePub()} priv={makePriv()} />);
    expect(screen.getByText(/Don't spell out words from your card/i)).toBeInTheDocument();
  });

  it('shows a live requirements indicator driven off the private state', () => {
    const notYet = makePriv({ plate: 'B', requirementsCard: { id: 'req_01', chars: 'RF5' } });
    const { unmount } = render(<WritePlates pub={makePub()} priv={notYet} />);
    expect(screen.getByTestId('req-indicator')).toHaveTextContent('not yet');
    unmount();

    const met = makePriv({ plate: 'RF5B', requirementsCard: { id: 'req_01', chars: 'RF5' } });
    render(<WritePlates pub={makePub()} priv={met} />);
    expect(screen.getByTestId('req-indicator')).toHaveTextContent('in order');
  });

  it('shows a waiting panel instead of the picker after submitting', () => {
    const priv = makePriv({ plate: 'RF5B', submitted: true });
    render(<WritePlates pub={makePub()} priv={priv} />);
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
    expect(screen.getByText(/Plate locked in/)).toBeInTheDocument();
  });
});

describe('Guessing — the Active Player is the only one who records anything', () => {
  it('gives the Active Player an award button per other player, never themselves', () => {
    const { pub, priv } = guessingFixture('p1', 'p1');
    render(<Guessing pub={pub} priv={priv} />);
    const list = screen.getByText('Who guessed it?').closest('.card') as HTMLElement;
    expect(within(list).getByRole('button', { name: 'Lincoln' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'April' })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Eric' })).toBeNull();
    expect(within(list).getByRole('button', { name: 'Nobody got it' })).toBeInTheDocument();
  });

  it('gives non-active players no award buttons and no input at all', () => {
    const { pub, priv } = guessingFixture('p1', 'p2');
    const { container } = render(<Guessing pub={pub} priv={priv} />);
    expect(screen.queryByText('Who guessed it?')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Nobody got it' })).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(screen.getByText(/Say your guess out loud/i)).toBeInTheDocument();
  });

  it('mirrors the Active Player plate to everyone so nobody has to look up', () => {
    const { pub, priv } = guessingFixture('p1', 'p3');
    render(<Guessing pub={pub} priv={priv} />);
    expect(screen.getByLabelText('Plate RNGR5')).toBeInTheDocument();
    expect(screen.getByText("Eric's plate")).toBeInTheDocument();
  });

  it('shows the reveal and a Next plate button once the turn resolves', () => {
    const { pub, priv } = guessingFixture('p1', 'p1');
    const resolved = makePub({
      ...pub,
      round: makeRound({
        ...pub.round!,
        currentResolution: {
          activePlayerId: 'p1',
          outcome: 'GUESSED',
          winnerPlayerId: 'p2',
          ownerCardTitle: 'Park Ranger',
          requirementsChars: 'RF5',
          requirementsMet: true,
          requirementsScored: true,
        },
      }),
    });
    render(<Guessing pub={resolved} priv={priv} />);
    expect(screen.getByText('Lincoln got it!')).toBeInTheDocument();
    expect(screen.getByText('Park Ranger')).toBeInTheDocument();
    expect(screen.getByText('✓ Bonus card scored')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next plate/ })).toBeInTheDocument();
  });
});

describe('Lobby', () => {
  it("disables Start below MIN_PLAYERS and hides the Cast button when unavailable", () => {
    const pub = makePub({
      phase: 'LOBBY',
      players: [makePlayer({ id: 'p1', displayName: 'Eric', isHost: true })],
    });
    render(<Lobby pub={pub} priv={makePriv()} castState="unavailable" onCast={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Cast/ })).toBeNull();
  });

  it('enables Start at 3 players and shows the Cast button when available', () => {
    const pub = makePub({ phase: 'LOBBY' });
    render(<Lobby pub={pub} priv={makePriv()} castState="disconnected" onCast={() => {}} />);
    expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Cast to a TV/ })).toBeInTheDocument();
  });

  it('gives non-hosts no Start button', () => {
    const pub = makePub({ phase: 'LOBBY' });
    render(<Lobby pub={pub} priv={makePriv({ playerId: 'p2', isHost: false })} />);
    expect(screen.queryByRole('button', { name: 'Start game' })).toBeNull();
  });
});

describe('RoundEnd / GameOver / Paused', () => {
  it('only the host advances the round', () => {
    const pub = makePub({ phase: 'ROUND_END' });
    const { unmount } = render(<RoundEnd pub={pub} priv={makePriv({ isHost: true })} />);
    expect(screen.getByRole('button', { name: /Next round/ })).toBeInTheDocument();
    unmount();
    render(<RoundEnd pub={pub} priv={makePriv({ playerId: 'p2', isHost: false })} />);
    expect(screen.queryByRole('button', { name: /Next round/ })).toBeNull();
  });

  it('words a shared victory as shared', () => {
    const pub = makePub({ phase: 'GAME_OVER', winnerPlayerIds: ['p1', 'p2'] });
    render(<GameOver pub={pub} priv={makePriv()} />);
    expect(screen.getByText(/Shared victory: Eric & Lincoln/)).toBeInTheDocument();
  });

  it('names a single winner', () => {
    const pub = makePub({ phase: 'GAME_OVER', winnerPlayerIds: ['p3'] });
    render(<GameOver pub={pub} priv={makePriv()} />);
    expect(screen.getByText('April wins!')).toBeInTheDocument();
  });

  it('names who we are waiting for when paused', () => {
    const pub = makePub({
      phase: 'PAUSED',
      pause: { active: true, reason: 'PLAYER_DISCONNECT', waitingForPlayerId: 'p2' },
    });
    render(<Paused pub={pub} />);
    expect(screen.getByText(/Waiting for Lincoln to reconnect/)).toBeInTheDocument();
  });
});
