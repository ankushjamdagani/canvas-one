import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { evergreen, contrastRatio, nodeKindColor, computeTagColors } from "./tokens";

describe("Evergreen tokens and styles.css single source check", () => {
  const cssPath = path.resolve(__dirname, "../../styles.css");
  const cssContent = fs.readFileSync(cssPath, "utf-8");

  const parseVars = (block: string): Record<string, string> => {
    const vars: Record<string, string> = {};
    const regex = /--([a-z0-9-]+)\s*:\s*([^;]+);/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(block)) !== null) {
      vars[`--${match[1]}`] = match[2].trim();
    }
    return vars;
  };

  // Extract the :root { ... } block
  const rootMatch = cssContent.match(/:root\s*\{([\s\S]*?)\n\}/);
  if (!rootMatch) {
    throw new Error("Could not find :root block in src/styles.css");
  }
  const rootVars = parseVars(rootMatch[1]);

  // Extract the plain @theme { ... } block (not @theme inline)
  const themeMatch = cssContent.match(/@theme\s*\{([\s\S]*?)\}/);
  if (!themeMatch) {
    throw new Error("Could not find plain @theme block in src/styles.css");
  }
  const themeVars = parseVars(themeMatch[1]);

  it("(a) asserts every Evergreen role variable in :root equals the value exported from tokens.ts", () => {
    // Surface & background roles
    expect(rootVars["--background"]).toBe(evergreen.controlSurface);
    expect(rootVars["--foreground"]).toBe(evergreen.ink);
    expect(rootVars["--card"]).toBe(evergreen.panel);
    expect(rootVars["--card-foreground"]).toBe(evergreen.ink);
    expect(rootVars["--popover"]).toBe(evergreen.controlSurface);
    expect(rootVars["--popover-foreground"]).toBe(evergreen.ink);

    // Primary action role
    expect(rootVars["--primary"]).toBe(evergreen.primary);
    // Directions board: text on action green is the shell colour (RV-17).
    expect(rootVars["--primary-foreground"]).toBe(evergreen.shell);
    expect(rootVars["--canvas"]).toBe(evergreen.canvas);
    expect(rootVars["--grid"]).toBe(evergreen.grid);
    expect(rootVars["--hairline-soft"]).toBe(evergreen.hairlineSoft);

    // Secondary & muted roles
    expect(rootVars["--secondary"]).toBe(evergreen.sunken);
    expect(rootVars["--secondary-foreground"]).toBe(evergreen.ink);
    expect(rootVars["--shadcn-muted"]).toBe(evergreen.sunken);
    expect(rootVars["--shadcn-muted-foreground"]).toBe(evergreen.secondary);

    // Accent role (interaction tint)
    expect(rootVars["--accent"]).toBe(evergreen.selectedTint);
    expect(rootVars["--accent-foreground"]).toBe(evergreen.ink);

    // Borders & dividers
    expect(rootVars["--border"]).toBe(evergreen.divider);
    expect(rootVars["--input"]).toBe(evergreen.controlBorderStrong);
    expect(rootVars["--control-border-strong"]).toBe(evergreen.controlBorderStrong);
    expect(rootVars["--ring"]).toBe(evergreen.primary);

    // Destructive role (--destructive equals evergreen.destructive and destructive-foreground on --destructive >= 4.5)
    expect(rootVars["--destructive"]).toBe(evergreen.destructive);
    expect(rootVars["--destructive-foreground"]).toBe("#FFFFFF");
    expect(contrastRatio(rootVars["--destructive-foreground"], rootVars["--destructive"])).toBeGreaterThanOrEqual(4.5);
    expect(rootVars["--destructive-hover"]).toBe(evergreen.destructiveHover);

    // Evergreen specific role variables
    expect(rootVars["--shell"]).toBe(evergreen.shell);
    expect(rootVars["--panel"]).toBe(evergreen.panel);
    expect(rootVars["--sunken"]).toBe(evergreen.sunken);
    expect(rootVars["--body"]).toBe(evergreen.body);
    expect(rootVars["--secondary-text"]).toBe(evergreen.secondary);
    expect(rootVars["--primary-hover"]).toBe(evergreen.primaryHover);
    expect(rootVars["--primary-pressed"]).toBe(evergreen.primaryPressed);
    expect(rootVars["--selected-edge"]).toBe(evergreen.selectedEdge);
    expect(rootVars["--branch"]).toBe(evergreen.branch);
    expect(rootVars["--branch-tint"]).toBe(evergreen.branchTint);
    expect(rootVars["--risk"]).toBe(evergreen.risk);
    expect(rootVars["--risk-text"]).toBe(evergreen.riskText);
    expect(rootVars["--risk-tint"]).toBe(evergreen.riskTint);
    expect(rootVars["--control-border"]).toBe(evergreen.controlBorder);
    expect(rootVars["--hover-border"]).toBe(evergreen.hoverBorder);
    expect(rootVars["--note"]).toBe(evergreen.note);
    expect(rootVars["--note-edge"]).toBe(evergreen.noteEdge);

    // Radii variables from plain @theme block
    expect(themeVars["--radius-tag"]).toBe(`${evergreen.radii.tag}px`);
    expect(themeVars["--radius-control"]).toBe(`${evergreen.radii.control}px`);
    expect(themeVars["--radius-node"]).toBe(`${evergreen.radii.node}px`);
    expect(themeVars["--radius-popover"]).toBe(`${evergreen.radii.popover}px`);
    expect(themeVars["--radius-card"]).toBe(`${evergreen.radii.card}px`);
    expect(themeVars["--radius-dock"]).toBe(`${evergreen.radii.dock}px`);

    // Ensure radii are no longer declared in :root
    expect(rootVars["--radius-tag"]).toBeUndefined();
    expect(rootVars["--radius-control"]).toBeUndefined();
    expect(rootVars["--radius-node"]).toBeUndefined();
    expect(rootVars["--radius-popover"]).toBeUndefined();
    expect(rootVars["--radius-card"]).toBeUndefined();
    expect(rootVars["--radius-dock"]).toBeUndefined();
  
});

  it("(b) asserts contrast >= 4.5 for required text and foreground pairs", () => {
    // Secondary #626D68 on panel, shell, canvas
    expect(contrastRatio(evergreen.secondary, evergreen.panel)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(evergreen.secondary, evergreen.shell)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(evergreen.secondary, evergreen.canvas)).toBeGreaterThanOrEqual(4.5);

    // Primary on shell
    expect(contrastRatio(evergreen.primary, evergreen.shell)).toBeGreaterThanOrEqual(4.5);

    // Primary-foreground on primary
    const primaryForeground = rootVars["--primary-foreground"];
    expect(contrastRatio(primaryForeground, evergreen.primary)).toBeGreaterThanOrEqual(4.5);

    // Destructive-foreground on --destructive (and evergreen.destructive)
    expect(contrastRatio(rootVars["--destructive-foreground"], rootVars["--destructive"])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", evergreen.destructive)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#FFFFFF", evergreen.destructiveHover)).toBeGreaterThanOrEqual(4.5);

    // Risk text on risk tint
    expect(contrastRatio(evergreen.riskText, evergreen.riskTint)).toBeGreaterThanOrEqual(4.5);

    // Branch on branch tint
    expect(contrastRatio(evergreen.branch, evergreen.branchTint)).toBeGreaterThanOrEqual(4.5);

    // Ink on every surface
    const surfaces = [evergreen.canvas, evergreen.shell, evergreen.panel, evergreen.sunken];
    for (const surface of surfaces) {
      expect(contrastRatio(evergreen.ink, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("(c) asserts controlBorderStrong contrast >= 3 against canvas, shell, and panel", () => {
    // The accessible input field boundary must achieve >= 3:1 against canvas, shell, and panel
    const inputBorderValue = rootVars["--input"];
    const controlBorderStrongValue = rootVars["--control-border-strong"];

    expect(contrastRatio(inputBorderValue, evergreen.canvas)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(inputBorderValue, evergreen.shell)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(inputBorderValue, evergreen.panel)).toBeGreaterThanOrEqual(3.0);

    expect(contrastRatio(controlBorderStrongValue, evergreen.canvas)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(controlBorderStrongValue, evergreen.shell)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(controlBorderStrongValue, evergreen.panel)).toBeGreaterThanOrEqual(3.0);

    expect(contrastRatio(evergreen.controlBorderStrong, evergreen.canvas)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(evergreen.controlBorderStrong, evergreen.shell)).toBeGreaterThanOrEqual(3.0);
    expect(contrastRatio(evergreen.controlBorderStrong, evergreen.panel)).toBeGreaterThanOrEqual(3.0);
  });

  it("(d) asserts meta #8A938F is NOT exported as a text token", () => {
    // #8A938F fails WCAG AA text contrast (3.16:1 < 4.5:1), so it must not be used for text tokens
    const evergreenKeys = Object.keys(evergreen);
    expect(evergreenKeys).not.toContain("meta");
    expect(evergreenKeys).not.toContain("textMeta");
    expect(evergreenKeys).not.toContain("metaText");

    // Informative text tokens in Evergreen are ink, body, secondary, riskText
    const textTokenValues = [evergreen.ink, evergreen.body, evergreen.secondary, evergreen.riskText];
    expect(textTokenValues).not.toContain("#8A938F");

    // Confirm that #8A938F indeed fails 4.5:1 text contrast on white
    expect(contrastRatio("#8A938F", evergreen.canvas)).toBeLessThan(4.5);
  });

  it("(e) asserts duplicate keys (hover, pressed, and flat radius keys) are removed", () => {
    const evergreenKeys = Object.keys(evergreen);
    expect(evergreenKeys).not.toContain("hover");
    expect(evergreenKeys).not.toContain("pressed");
    expect(evergreenKeys).not.toContain("tag");
    expect(evergreenKeys).not.toContain("control");
    expect(evergreenKeys).not.toContain("node");
    expect(evergreenKeys).not.toContain("popover");
    expect(evergreenKeys).not.toContain("card");
    expect(evergreenKeys).not.toContain("dock");
    expect(evergreenKeys).not.toContain("inputBorder");
    expect(evergreen).toHaveProperty("primaryHover");
    expect(evergreen).toHaveProperty("primaryPressed");
    expect(evergreen).toHaveProperty("radii");
    expect(evergreen).toHaveProperty("type");
    expect(evergreen).toHaveProperty("controlBorderStrong");
    expect(evergreen).toHaveProperty("destructive");
    expect(evergreen).toHaveProperty("destructiveHover");
  });

  it("(f) asserts styles.css contains no Google Fonts CDN and no Spline Sans", () => {
    expect(cssContent).not.toContain("fonts.googleapis");
    expect(cssContent).not.toContain("Spline");
  });

  it("(g) asserts typography type tokens in @theme equal evergreen.type", () => {
    for (const [key, size] of Object.entries(evergreen.type)) {
      expect(themeVars[`--text-${key}`]).toBe(`${size}px`);
    }
  });

  it("(h) asserts elevation shadow tokens: @theme uses var() indirection; :root holds Evergreen defaults", () => {
    // Shadow tokens in @theme reference --tw-shadow-* vars so applyTokens() can override at runtime.
    expect(themeVars["--shadow-raised"]).toBe("var(--tw-shadow-raised)");
    expect(themeVars["--shadow-popover"]).toBe("var(--tw-shadow-popover)");
    expect(themeVars["--shadow-floating"]).toBe("var(--tw-shadow-floating)");
    // The :root defaults must match the Evergreen values from tokens.ts.
    expect(rootVars["--tw-shadow-raised"]).toBe(evergreen.shadow.raised);
    expect(rootVars["--tw-shadow-popover"]).toBe(evergreen.shadow.popover);
    expect(rootVars["--tw-shadow-floating"]).toBe(evergreen.shadow.floating);
  });

  it("(i) asserts nodeKindColor covers exactly the six componentCatalog layers, lowercased", () => {
    const layers = ["clients", "edge", "compute", "data", "messaging", "operations"];
    expect(Object.keys(nodeKindColor).sort()).toEqual([...layers].sort());
    for (const layer of layers) {
      expect(nodeKindColor).toHaveProperty(layer);
      expect(typeof nodeKindColor[layer as keyof typeof nodeKindColor]).toBe("string");
    }
  });

  it("(j) asserts nodeKindColor equals the decision D35 stripe colours exactly", () => {
    // D35: a dedicated six-colour set, deliberately distinct from the semantic
    // primary/branch/risk roles used elsewhere in Evergreen.
    expect(nodeKindColor.clients).toBe("#4F6D8F");
    expect(nodeKindColor.edge).toBe("#2B7A83");
    expect(nodeKindColor.compute).toBe("#56773A");
    expect(nodeKindColor.messaging).toBe("#8A6A1F");
    expect(nodeKindColor.data).toBe("#8A4F6E");
    expect(nodeKindColor.operations).toBe("#5F646B");
  });

  it("(k) asserts D35 stripe colours are NOT the semantic primary/branch/risk roles", () => {
    const semanticRoles = [evergreen.primary, evergreen.branch, evergreen.risk];
    for (const color of Object.values(nodeKindColor)) {
      expect(semanticRoles).not.toContain(color);
    }
  });

  it("(k2) asserts each node-kind colour reaches >=3:1 contrast against white and the panel surface", () => {
    // Non-text, meaningful state/kind indicator bar (design.md Accessibility corrections).
    for (const [layer, color] of Object.entries(nodeKindColor)) {
      expect(contrastRatio(color, "#FFFFFF"), `${layer} vs #FFFFFF`).toBeGreaterThanOrEqual(3.0);
      expect(contrastRatio(color, evergreen.panel), `${layer} vs panel`).toBeGreaterThanOrEqual(3.0);
    }
  });

  it("(l) asserts styles.css plain @theme node-kind colour vars equal tokens.ts nodeKindColor", () => {
    expect(themeVars["--color-node-kind-clients"]).toBe(nodeKindColor.clients);
    expect(themeVars["--color-node-kind-edge"]).toBe(nodeKindColor.edge);
    expect(themeVars["--color-node-kind-compute"]).toBe(nodeKindColor.compute);
    expect(themeVars["--color-node-kind-data"]).toBe(nodeKindColor.data);
    expect(themeVars["--color-node-kind-messaging"]).toBe(nodeKindColor.messaging);
    expect(themeVars["--color-node-kind-operations"]).toBe(nodeKindColor.operations);
  });

});

describe("computeTagColors (inspector kind tag, D44 O4)", () => {
  for (const [layer, stripe] of Object.entries(nodeKindColor)) {
    it(`${layer}: tag text reaches 4.5:1 on its tinted background composited on the panel`, () => {
      const tag = computeTagColors(stripe);
      expect(contrastRatio(tag.color, tag["--bg-solid"])).toBeGreaterThanOrEqual(4.5);
      expect(tag.backgroundColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\.12\)$/);
    });
  }
});
