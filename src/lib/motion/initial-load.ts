export const INITIAL_LOAD_TIMEOUT_MS = 3000;

declare global {
  interface Window {
    __canvasInitialLoad?: { deadline: number; expired: boolean; timer: number };
  }
}

export const INITIAL_LOAD_STYLE = `@keyframes initial-loader-timeout{to{opacity:0;visibility:hidden;pointer-events:none}}@keyframes initial-loader-exit{to{opacity:0;visibility:hidden;pointer-events:none}}@keyframes initial-loader-face-timeout{to{opacity:0;transform:translateY(-8px) scale(0.92)}}@keyframes initial-loader-face-exit{to{opacity:0;transform:translateY(-8px) scale(0.92)}}.initial-load-overlay,[data-initial-loader]{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:var(--shell,#fbfaf7);color:var(--ink,#16201d);animation:initial-loader-timeout 0.28s cubic-bezier(0.4,0,0.2,1) 3s forwards}.initial-load-overlay>.loading-face,[data-initial-loader]>.loading-face{animation:initial-loader-face-timeout 0.28s cubic-bezier(0.4,0,0.2,1) 3s forwards;display:grid;place-items:center}.initial-load-overlay[data-loader-exit],[data-initial-loader][data-loader-exit]{animation:initial-loader-exit 0.28s cubic-bezier(0.4,0,0.2,1) forwards;pointer-events:none}.initial-load-overlay[data-loader-exit]>.loading-face,[data-initial-loader][data-loader-exit]>.loading-face{animation:initial-loader-face-exit 0.28s cubic-bezier(0.4,0,0.2,1) forwards}.initial-load-overlay[hidden],[data-initial-loader][hidden]{display:none!important}@media (prefers-reduced-motion:reduce){.initial-load-overlay,[data-initial-loader],.initial-load-overlay>.loading-face,[data-initial-loader]>.loading-face,.initial-load-overlay[data-loader-exit],[data-initial-loader][data-loader-exit],.initial-load-overlay[data-loader-exit]>.loading-face,[data-initial-loader][data-loader-exit]>.loading-face{animation-duration:0s}.loading-face .canvas-one-face *{animation:none!important;transition:none!important}}`;

// Runs before content is parsed, independently of the application bundle.
export const INITIAL_LOAD_BOOTSTRAP = `(() => {
  const boot = window.__canvasInitialLoad = { deadline: Date.now() + ${INITIAL_LOAD_TIMEOUT_MS}, expired: false, timer: 0 };
  const finish = (event) => {
    const loader = event.target;
    if (!(loader instanceof HTMLElement) || !loader.matches('[data-initial-loader]')) return;
    if (event.animationName !== 'initial-loader-exit' && event.animationName !== 'initial-loader-timeout') return;
    loader.hidden = true;
    loader.style.display = 'none';
    window.removeEventListener('animationend', finish);
  };
  window.addEventListener('animationend', finish);
  boot.timer = window.setTimeout(() => {
    boot.expired = true;
    const loader = document.querySelector('[data-initial-loader]');
    if (!loader || loader.hidden) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      loader.hidden = true;
      loader.style.display = 'none';
    } else {
      const style = getComputedStyle(loader);
      if (style.animationName === 'none') {
        loader.hidden = true;
        loader.style.display = 'none';
      } else if (style.visibility !== 'hidden' && Number(style.opacity) === 1) loader.dataset.loaderExit = 'true';
    }
  }, ${INITIAL_LOAD_TIMEOUT_MS});
})();`;

export function dismissInitialLoader(loader: HTMLElement): void {
  if (loader.hidden) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    loader.hidden = true;
    loader.style.display = 'none';
    return;
  }
  const style = getComputedStyle(loader);
  // Missing/disabled loader CSS cannot fire animationend; never leave its face visible.
  if (style.animationName === 'none') {
    loader.hidden = true;
    loader.style.display = 'none';
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
