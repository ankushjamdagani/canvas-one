declare const TextDecoder: { new(label: string, options: { fatal: boolean }): { decode(input: Uint8Array): string } };
import { canonicalJson } from "../studio/canonical.js";
import { validateDocument, type Issue } from "../studio/validate.js";
import type { PartContent } from "./types.js";
import { createIssue } from "../studio/issue.js";

const PART_CONTENT_BYTES = 512 * 1024;
export const PART_FILE_BYTES = PART_CONTENT_BYTES + 32 * 1024;
export type SavedPart = {
  readonly id: string;
  readonly revision: number;
  readonly label: string;
  readonly description: string;
  readonly content: PartContent;
};
type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly Issue[] };
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
function closed(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).every((key) => keys.includes(key)) &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Reuses the closed Document schema for every nested definition and typed reference. */
export function validatePartContent(raw: unknown): Result<PartContent> {
  const encoded = canonicalJson(raw, PART_CONTENT_BYTES);
  if (!encoded.ok) return encoded;
  if (
    !object(raw) ||
    !closed(raw, [
      "schema",
      "elements",
      "connections",
      "relations",
      "schemas",
      "fixtures",
      "refinements",
      "view",
    ]) ||
    raw.schema !== "studio-part-content/1"
  ) {
    return {
      ok: false,
      issues: [createIssue("structural-rule", "Expected closed studio-part-content/1 content.")],
    };
  }
  if (
    !object(raw.view) ||
    !closed(raw.view, ["placements", "groups", "notes"])
  ) {
    return { ok: false, issues: [createIssue("structural-rule", "Invalid part view.", ["view"])] };
  }
  for (const [key, max] of [
    ["elements", 50],
    ["connections", 100],
    ["relations", 100],
  ] as const) {
    if (
      !Array.isArray(raw[key]) ||
      raw[key].length > max ||
      (key === "elements" && raw[key].length === 0)
    ) {
      return {
        ok: false,
        issues: [
          createIssue(
            "structural-rule",
            `Part ${key} must contain ${key === "elements" ? "1" : "0"}–${max} entries.`,
            [key],
          ),
        ],
      };
    }
  }
  if (!Array.isArray(raw.view.notes) || raw.view.notes.length > 50) {
    return {
      ok: false,
      issues: [
        createIssue("structural-rule", "A part may contain at most 50 notes.", ["view", "notes"]),
      ],
    };
  }
  // Synthetic container IDs must never collide with user definitions or payload text.
  let next = 0;
  const containerId = () => {
    let id: string;
    do {
      id = `ffffffff-ffff-4fff-8fff-${(++next).toString(16).padStart(12, "0")}`;
    } while (encoded.text.includes(id));
    return id;
  };
  const { view: _view, ...records } = raw;
  const document = {
    ...records,
    schema: "studio-model/1",
    id: containerId(),
    title: "Saved part",
    scenarios: [],
    views: [
      {
        ...raw.view,
        id: containerId(),
        label: "Part",
        connectionIds: (raw.connections as { id: string }[]).map(
          (entry) => entry?.id,
        ),
        relationIds: (raw.relations as { id: string }[]).map(
          (entry) => entry?.id,
        ),
      },
    ],
  };
  const validation = validateDocument(document);
  if (!validation.ok) return validation;
  return { ok: true, value: JSON.parse(encoded.text) as PartContent };
}

export function validateSavedPart(raw: unknown): Result<SavedPart> {
  if (
    !object(raw) ||
    !closed(raw, ["id", "revision", "label", "description", "content"])
  ) {
    return {
      ok: false,
      issues: [createIssue("structural-rule", "Expected a closed saved part record.")],
    };
  }
  if (
    typeof raw.id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      raw.id,
    )
  ) {
    return { ok: false, issues: [createIssue("structural-rule", "Invalid part ID.", ["id"])] };
  }
  if (!Number.isSafeInteger(raw.revision) || (raw.revision as number) < 1) {
    return {
      ok: false,
      issues: [
        createIssue("structural-rule", "Part revision must be a positive safe integer.", ["revision"]),
      ],
    };
  }
  if (
    typeof raw.label !== "string" ||
    !raw.label.trim() ||
    [...raw.label].length > 80 ||
    typeof raw.description !== "string" ||
    [...raw.description].length > 4000
  ) {
    return {
      ok: false,
      issues: [
        createIssue(
          "structural-rule",
          "Use a label of 1–80 characters and a description of at most 4,000 characters.",
        ),
      ],
    };
  }
  const encoded = canonicalJson(raw, PART_FILE_BYTES);
  if (!encoded.ok) return encoded;
  const content = validatePartContent(raw.content);
  if (!content.ok) return content;
  return {
    ok: true,
    value: {
      id: raw.id,
      revision: raw.revision as number,
      label: raw.label,
      description: raw.description,
      content: content.value,
    },
  };
}

export function parsePartFile(bytes: Uint8Array): Result<SavedPart> {
  if (bytes.byteLength > PART_FILE_BYTES)
    return {
      ok: false,
      issues: [createIssue("structural-rule", "Part file is too large. Select a smaller part.")],
    };
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return {
      ok: false,
      issues: [createIssue("structural-rule", "Choose a valid UTF-8 part JSON file.")],
    };
  }
  if (
    !object(raw) ||
    !closed(raw, ["format", "version", "part"]) ||
    raw.format !== "system-studio-part" ||
    raw.version !== 1
  ) {
    return {
      ok: false,
      issues: [createIssue("structural-rule", "Only system-studio-part version 1 is supported.")],
    };
  }
  return validateSavedPart(raw.part);
}
