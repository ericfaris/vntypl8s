/// <reference types="@testing-library/jest-dom/vitest" />
import { expect } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';

// Register jest-dom explicitly: under Vitest 4 the side-effect import
// '@testing-library/jest-dom/vitest' extends a different `expect` instance,
// so every matcher failed with "Invalid Chai property".
expect.extend(matchers);

// jsdom has no real media pipeline — HTMLMediaElement.play() logs a noisy
// "not implemented" error to the console otherwise. The sound module (see
// common/sound.ts) triggers real <audio> playback from several screens, so
// stub it out for every test rather than per-file.
if (typeof window !== 'undefined' && window.HTMLMediaElement) {
  window.HTMLMediaElement.prototype.play = () => Promise.resolve();
  window.HTMLMediaElement.prototype.pause = () => undefined;
}
