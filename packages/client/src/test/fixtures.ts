import {
  TOTAL_ROUNDS,
  type PrivateState,
  type PublicPlayer,
  type PublicRoom,
  type PublicRound,
} from '@vntypl8s/shared';

export function makePlayer(overrides: Partial<PublicPlayer> & { id: string }): PublicPlayer {
  return {
    displayName: overrides.id,
    connected: true,
    isHost: false,
    canCast: false,
    pendingJoin: false,
    joinOrder: 0,
    ownerScore: 0,
    requirementsScore: 0,
    totalScore: 0,
    submitted: false,
    plateLength: 0,
    ...overrides,
  };
}

export function makeRound(overrides: Partial<PublicRound> = {}): PublicRound {
  return {
    roundNumber: 1,
    turnOrder: [],
    turnIndex: -1,
    activePlayerId: null,
    revealedPlate: null,
    grid: [],
    currentResolution: null,
    resolutions: [],
    ...overrides,
  };
}

/** Minimal but structurally valid PublicRoom, defaulted to 3-player WRITE_PLATES. */
export function makePub(overrides: Partial<PublicRoom> = {}): PublicRoom {
  const players =
    overrides.players ?? [
      makePlayer({ id: 'p1', displayName: 'Eric', isHost: true, joinOrder: 0 }),
      makePlayer({ id: 'p2', displayName: 'Lincoln', joinOrder: 1 }),
      makePlayer({ id: 'p3', displayName: 'April', joinOrder: 2 }),
    ];
  return {
    code: '1234',
    phase: 'WRITE_PLATES',
    players,
    round: makeRound(),
    timer: { enabled: true, phaseDeadline: null },
    pause: { active: false, reason: null, waitingForPlayerId: null },
    castConnected: false,
    winnerPlayerIds: [],
    totalRounds: TOTAL_ROUNDS,
    serverNow: Date.now(),
    ...overrides,
  };
}

export function makePriv(overrides: Partial<PrivateState> = {}): PrivateState {
  return {
    playerId: 'p1',
    reconnectToken: 'tok',
    isHost: true,
    pendingJoin: false,
    ownerCard: { id: 'own_001', title: 'Park Ranger' },
    requirementsCard: { id: 'req_01', chars: 'RF5' },
    plate: '',
    submitted: false,
    requirementsMet: false,
    isActivePlayer: false,
    ownerPile: [],
    requirementsPile: [],
    ...overrides,
  };
}

/** A GUESSING-phase fixture where `activeId` is the Active Player. */
export function guessingFixture(activeId: string, myId: string) {
  const pub = makePub({
    phase: 'GUESSING',
    round: makeRound({
      turnOrder: ['p1', 'p2', 'p3'],
      turnIndex: ['p1', 'p2', 'p3'].indexOf(activeId),
      activePlayerId: activeId,
      revealedPlate: 'RNGR5',
      grid: [
        { cardId: 'own_001', title: 'Park Ranger', status: 'IN_GRID', claimedByPlayerId: null },
        { cardId: 'own_002', title: 'Truck Driver', status: 'IN_GRID', claimedByPlayerId: null },
      ],
    }),
  });
  const priv = makePriv({
    playerId: myId,
    isHost: myId === 'p1',
    isActivePlayer: myId === activeId,
  });
  return { pub, priv };
}
