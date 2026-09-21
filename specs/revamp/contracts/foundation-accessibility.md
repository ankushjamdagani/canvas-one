# Foundation contrast decisions

Planning evidence only, measured 2026-09-22 with sRGB relative luminance and `(Llighter + .05)/(Ldarker + .05)`. Source is extracted design `tokens/colors.css`. No UI has been changed. Browser verification remains required after implementation, including actual compositing, fonts, states and all surface pairings.

Targets: normal text at least 4.5:1; meaningful control boundaries/state indicators at least 3:1 against adjacent colors. Decorative dividers need not independently identify a control. See [WCAG contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Disabled controls are not an excuse to make enabled metadata unreadable.

| Source foreground/background | Computed ratio | Lead token decision |
|---|---|---|
| Secondary #6B7671 / panel #F7F5F1 | 4.329 | Use text-secondary #626D68 across paper surfaces; 4.937 on panel |
| Secondary #6B7671 / shell #FBFAF7 | 4.516 | Source passes here, but shared secondary token uses safer correction above |
| Meta #8A938F / white | 3.158 | Do not use for normal-sized informative metadata; use corrected secondary |
| Purple #7C5FC0 / purple tint #F7F4FC | 4.536 | Retain for this pairing; verify other states separately |
| Clay #B4674A / clay tint #FBF1EA | 3.790 | Retain clay as decorative role; use #A15B40 for risk text (4.619) |
| Green #0B5C54 / shell #FBFAF7 | 7.527 | Retain for actions/focus |
| Green edge #A8CBC5 / white | 1.748 | Selected decoration only; cannot be the sole focus/control-state indicator |

No opacity reduction on informative text without measuring the composite. Use solid action green for the focus indicator with enough thickness/offset to remain distinct on adjacent surfaces. The light control border alone may not identify an enabled field; review its contrasting boundary/fill or add a stronger semantic control-border token. Measure final control pairs rather than globally darkening decorative dividers.

The design's 9px metadata is not a mandated text size. Use readable component typography and verify at 200% zoom with no lost content. Coarse-pointer interactive targets use 44px minimum under this product's acceptance criterion; nominal 32px desktop visual controls are not the phone hit-target specification. These corrections apply centrally, not through per-screen color exceptions.
