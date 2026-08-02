// On-screen debug logging for the TV (Chromecast guide §3.8).
//
// You cannot easily attach devtools to a physical Chromecast. Monkey-patch the
// console and the global error hooks into a bounded ring buffer, rendered as
// an overlay toggled by a TOGGLE_DEBUG custom message from the sender.
//
// This module MUST be imported first in main.tsx so it captures boot-time
// errors from the rest of the bundle.

export interface DebugEntry {
  t: number;
  level: 'log' | 'warn' | 'error';
  text: string;
}

const MAX_ENTRIES = 200;
const buffer: DebugEntry[] = [];
const subs = new Set<() => void>();

function push(level: DebugEntry['level'], args: unknown[]): void {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  buffer.push({ t: Date.now(), level, text });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
  for (const cb of subs) cb();
}

export function getDebugEntries(): readonly DebugEntry[] {
  return buffer;
}

export function subscribeDebug(cb: () => void): () => void {
  subs.add(cb);
  return () => subs.delete(cb);
}

export function isDebugOn(): boolean {
  return !!(window as unknown as { __vpDebug?: boolean }).__vpDebug;
}

/** receiver.html's TOGGLE_DEBUG handler calls window.__vpOnDebugToggle. */
export function onDebugToggle(cb: () => void): () => void {
  const w = window as unknown as { __vpOnDebugToggle?: () => void };
  const prev = w.__vpOnDebugToggle;
  w.__vpOnDebugToggle = () => {
    prev?.();
    cb();
  };
  return () => {
    w.__vpOnDebugToggle = prev;
  };
}

let installed = false;
export function installDebugCapture(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(level, args);
      original(...args);
    };
  }

  window.addEventListener('error', (e) => {
    push('error', [`window.onerror: ${e.message}`, `${e.filename}:${e.lineno}`]);
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('error', ['unhandledrejection:', String((e as PromiseRejectionEvent).reason)]);
  });
}

installDebugCapture();
