/** Owns only explicit leases; shared host services without a disposer are never closed. */
export function createCompositionLifetime() {
  let active = true;
  let generation = 0;
  let release: (() => void) | undefined;
  const clear = () => { const owned = release; release = undefined; owned?.(); };
  return {
    activate() { active = true; },
    begin() { clear(); return ++generation; },
    current(token: number) { return active && token === generation; },
    adopt(token: number, dispose: () => void) {
      if (!active || token !== generation) { dispose(); return false; }
      clear(); release = dispose; return true;
    },
    dispose() { active = false; generation++; clear(); },
  };
}
