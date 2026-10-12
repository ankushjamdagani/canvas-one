export const INITIAL_LOAD_TIMEOUT_MS = 3000;

declare global {
  interface Window {
    __canvasInitialLoad?: { deadline: number; expired: boolean; timer: number };
  }
}

// Runs before content is parsed, independently of the application bundle.
export const INITIAL_LOAD_BOOTSTRAP = `(() => {
  const boot = window.__canvasInitialLoad = { deadline: Date.now() + ${INITIAL_LOAD_TIMEOUT_MS}, expired: false, timer: 0 };
  const finish = (event) => {
    const loader = event.target;
    if (!(loader instanceof HTMLElement) || !loader.matches('[data-initial-loader]')) return;
    if (event.animationName !== 'initial-loader-exit' && event.animationName !== 'initial-loader-timeout') return;
    loader.hidden = true;
    window.removeEventListener('animationend', finish);
  };
  window.addEventListener('animationend', finish);
  boot.timer = window.setTimeout(() => {
    boot.expired = true;
    const loader = document.querySelector('[data-initial-loader]');
    if (!loader || loader.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) loader.hidden = true;
    else {
      const style = getComputedStyle(loader);
      if (style.animationName === 'none') loader.hidden = true;
      else if (style.visibility !== 'hidden' && Number(style.opacity) === 1) loader.dataset.loaderExit = 'true';
    }
  }, ${INITIAL_LOAD_TIMEOUT_MS});
})();`;

export function dismissInitialLoader(loader: HTMLElement): void {
  if (loader.hidden) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    loader.hidden = true;
    return;
  }
  const style = getComputedStyle(loader);
  // Missing/disabled loader CSS cannot fire animationend; never leave its face visible.
  if (style.animationName === 'none') {
    loader.hidden = true;
    return;
  }
  // A fallback already fading out must not restart at full opacity on hydration.
  if (style.visibility === 'hidden' || Number(style.opacity) < 1 || loader.dataset.loaderExit) return;
  loader.dataset.loaderExit = 'true';
}

export function initialLoadExpired(): boolean {
  if (typeof window === 'undefined') return false;
  const boot = window.__canvasInitialLoad;
  if (boot && (boot.expired || Date.now() >= boot.deadline)) return true;
  // The CSS timeout also releases content if the bootstrap script was blocked.
  const loader = document.querySelector<HTMLElement>('[data-initial-loader]');
  return !!loader && (!!loader.hidden || getComputedStyle(loader).visibility === 'hidden');
}
