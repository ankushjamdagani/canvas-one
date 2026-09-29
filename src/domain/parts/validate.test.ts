import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Document } from "../studio/model";
import { captureSelection } from "./capture";
import {
  parsePartFile,
  validatePartContent,
  validateSavedPart,
} from "./validate";

const load = (family = "s03") =>
  JSON.parse(
    readFileSync(`specs/revamp/fixtures/${family}.json`, "utf8"),
  ) as Document;
function content(family = "s03") {
  const document = load(family);
  const captured = captureSelection(document, document.views[0].id, {
    elementIds: document.views[0].placements.map(
      (placement) => placement.elementId,
    ),
    noteIds: [],
  });
  if (!captured.ok)
    throw new Error(captured.issues.map((issue) => issue.message).join("; "));
  return captured.content;
}
describe("strict detached part validation", () => {
  it.each(["s01", "s02", "s03", "s04", "s05"])(
    "validates self-contained %s model content without scenarios",
    (family) => {
      expect(validatePartContent(content(family))).toMatchObject({ ok: true });
    },
  );
  it("rejects unknown nested reference fields, scripts, and dangling references", () => {
    const valid = content();
    expect(validatePartContent({ ...valid, scripts: [] }).ok).toBe(false);
    expect(
      validatePartContent({
        ...valid,
        elements: [
          { ...valid.elements[0], unexpectedPortId: crypto.randomUUID() },
        ],
      }).ok,
    ).toBe(false);
    expect(validatePartContent({ ...valid, schemas: [] }).ok).toBe(false);
  });
  it("rejects empty, over-limit, invalid Unicode and oversized parts", () => {
    const valid = content();
    expect(validatePartContent({ ...valid, elements: [] }).ok).toBe(false);
    expect(
      validatePartContent({
        ...valid,
        elements: Array(51).fill(valid.elements[0]),
      }).ok,
    ).toBe(false);
    expect(
      validatePartContent({
        ...valid,
        elements: [{ ...valid.elements[0], label: "\ud800" }],
      }).ok,
    ).toBe(false);
    expect(
      validatePartContent({ ...valid, untrusted: "x".repeat(512 * 1024) }).ok,
    ).toBe(false);
  });
  it("round-trips exact Unicode/user payloads and rejects malformed standalone envelopes", () => {
    const part = {
      id: crypto.randomUUID(),
      revision: 4,
      label: "Cache 🧩",
      description: "<script>text only</script>",
      content: content(),
    };
    const bytes = new TextEncoder().encode(
      JSON.stringify({ format: "system-studio-part", version: 1, part }),
    );
    expect(parsePartFile(bytes)).toEqual({ ok: true, value: part });
    expect(parsePartFile(new Uint8Array([0xff])).ok).toBe(false);
    expect(
      parsePartFile(
        new TextEncoder().encode(
          JSON.stringify({ format: "system-studio-part", version: 9, part }),
        ),
      ).ok,
    ).toBe(false);
    expect(validateSavedPart({ ...part, revision: 0 }).ok).toBe(false);
    expect(validateSavedPart({ ...part, actors: [] }).ok).toBe(false);
  });
});
