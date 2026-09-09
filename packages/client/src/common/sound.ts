// Lightweight sound-effect + voice-line manager for the phone app. The TV
// receiver intentionally stays silent (see receiver.html's CAF boot block —
// "we play no audio"), so this module is only ever imported by player code.
//
// Every effect here follows either a direct tap (tile picker, submit,
// awarding a guess) or a phase transition that arrives moments after one
// (advancing a round, game over) — by the time any of these fire, the phone
// has already had at least one user gesture, which is what browsers require
// before HTMLAudioElement.play() is allowed to make sound. We still swallow
// play() rejections defensively so a blocked or missing clip never breaks
// gameplay.

export type SfxName =
  | 'tile-tap'
  | 'plate-submit'
  | 'reveal'
  | 'correct'
  | 'wrong'
  | 'timer-tick'
  | 'round-end'
  | 'game-over';

export type SpeechName = 'round1' | 'round2' | 'round3' | 'game-over';

const SFX_FILES: Record<SfxName, string> = {
  'tile-tap': '/audio/sfx/tile-tap.mp3',
  'plate-submit': '/audio/sfx/plate-submit.mp3',
  reveal: '/audio/sfx/reveal.mp3',
  correct: '/audio/sfx/correct.mp3',
  wrong: '/audio/sfx/wrong.mp3',
  'timer-tick': '/audio/sfx/timer-tick.mp3',
  'round-end': '/audio/sfx/round-end.mp3',
  'game-over': '/audio/sfx/game-over.mp3',
};

const SPEECH_FILES: Record<SpeechName, string> = {
  round1: '/audio/speech/round1.mp3',
  round2: '/audio/speech/round2.mp3',
  round3: '/audio/speech/round3.mp3',
  'game-over': '/audio/speech/game-over.mp3',
};

const LS_MUTED = 'vp:muted';

const sfxCache = new Map<string, HTMLAudioElement>();
const speechCache = new Map<string, HTMLAudioElement>();

function elementFor(cache: Map<string, HTMLAudioElement>, src: string): HTMLAudioElement {
  let el = cache.get(src);
  if (!el) {
    el = new Audio(src);
    el.preload = 'auto';
    cache.set(src, el);
  }
  return el;
}

function play(el: HTMLAudioElement) {
  if (muted) return;
  try {
    el.currentTime = 0;
    void el.play()?.catch(() => undefined);
  } catch {
    // Autoplay restrictions or a missing file — sound is a nice-to-have.
  }
}

let muted = false;
try {
  muted = localStorage.getItem(LS_MUTED) === '1';
} catch {
  muted = false;
}
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const sound = {
  playSfx(name: SfxName) {
    play(elementFor(sfxCache, SFX_FILES[name]));
  },
  playSpeech(name: SpeechName) {
    play(elementFor(speechCache, SPEECH_FILES[name]));
  },
  isMuted() {
    return muted;
  },
  toggleMuted() {
    muted = !muted;
    try {
      localStorage.setItem(LS_MUTED, muted ? '1' : '0');
    } catch {
      // Private browsing / storage disabled — mute state just won't persist.
    }
    notify();
  },
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
