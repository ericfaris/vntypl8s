// One shared Cast context per app (Chromecast guide §4.5).
//
// useCastSync is called EXACTLY ONCE, here. Never let the Cast button and a
// status chip each instantiate their own hook — that is the documented
// production bug where three components each minted their own token and the
// receiver ended up bootstrapped against whichever arrived last.
import { createContext, useContext, type ReactNode } from 'react';
import { useCastSync, type CastSync, type UseCastSyncArgs } from './useCastSync.js';

const CastContext = createContext<CastSync | null>(null);

export function CastProvider({ children, ...args }: UseCastSyncArgs & { children: ReactNode }) {
  const cast = useCastSync(args);
  return <CastContext.Provider value={cast}>{children}</CastContext.Provider>;
}

export function useCast(): CastSync {
  const ctx = useContext(CastContext);
  if (!ctx) throw new Error('useCast must be used within a CastProvider');
  return ctx;
}
