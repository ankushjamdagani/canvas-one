export const INITIAL_LOAD_TIMEOUT_MS = 3000;

declare global {
  interface Window {
    __canvasInitialLoad?: { deadline: number; expired: boolean; timer: number };
  }
}

// Runs before content is parsed, independently of the application bundle.
export const INITIAL_LOAD_BOOTSTRAP = `(() => {
  const boot = window.__canvasInitialLoad = { deadline: Date.now() + ${INITIAL_LOAD_TIMEOUT_MS}, expired: false, timer: 0 };
  boot.timer = window.setTimeout(() => {
    boot.expired = true;
    const loader = document.querySelector('[data-initial-loader]');
    if (loader) loader.hidden = true;
  }, ${INITIAL_LOAD_TIMEOUT_MS});
})();`;

export function initialLoadExpired(): boolean {
  if (typeof window === 'undefined') return false;
  const boot = window.__canvasInitialLoad;
  if (boot && (boot.expired || Date.now() >= boot.deadline)) return true;
  // The CSS timeout also releases content if the bootstrap script was blocked.
  const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
  return !!loader && (!!loader.hidden || getComputedStyle(loader).visibility === 'hidden');
}
