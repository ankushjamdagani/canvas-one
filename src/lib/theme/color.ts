import { getThemeRoot } from './ThemeContext';
let rootStyle: string | null | undefined;
let previousRoot: HTMLElement | undefined;
let actionRgb = '11,92,84';
/** Canvas effects resolve colours again only when root theme overrides change. */
export function readActionRgb(): string {
  const root = getThemeRoot();
  const style = root.getAttribute('style');
  if (style !== rootStyle || root !== previousRoot) {
    previousRoot = root;
    rootStyle = style;
    actionRgb = getComputedStyle(root).getPropertyValue('--action-rgb').trim();
  }
  return actionRgb;
}
