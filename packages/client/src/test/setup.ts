import '@testing-library/jest-dom/vitest';

// jsdom has no real media pipeline — HTMLMediaElement.play() logs a noisy
// "not implemented" error to the console otherwise. The sound module (see
// common/sound.ts) triggers real <audio> playback from several screens, so
// stub it out for every test rather than per-file.
if (typeof window !== 'undefined' && window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => undefined;
}
