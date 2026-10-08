let rootStyle: string | null | undefined;
let actionRgb = '11,92,84';
/** Canvas effects resolve colours again only when root theme overrides change. */
export function readActionRgb(): string {
  const style = document.documentElement.getAttribute('style');
  if (style !== rootStyle) {
    rootStyle = style;
    actionRgb = getComputedStyle(document.documentElement).getPropertyValue('--action-rgb').trim();
  }
  return actionRgb;
}
