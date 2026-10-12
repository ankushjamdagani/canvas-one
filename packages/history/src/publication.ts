/**
 * Pure Publication Metadata and Version helpers for System Studio:
 * - PublicationMetadata validation (version parts safe integers 0–999999;
 *   title trimmed 1–80 code points; rationale 0–4000 code points;
 *   ticketUrl null or absolute http(s) <= 2048 chars with no credentials;
 *   hostile schemes rejected).
 * - versionKey derivation 'M.m.p' with no leading zeros.
 * - Numeric comparison (0.10.0 > 0.9.9).
 * - Version suggestions: first publication proposes 0.1.0, later ones offer
 *   major/minor/patch bumps with resets; bumps overflowing 999999 are marked disabled
 *   (never wrapped or clamped).
 */

import { createIssue, type ValidationIssue } from '@canvas-one/whiteboard';
import type { PublicationMetadata, SemanticVersion } from './records.js';

export type PublicationIssue = ValidationIssue<'wrong-type' | 'missing-property' | 'out-of-range' | 'too-long' | 'structural-rule'>;
type Issue = PublicationIssue;
// URL is a web-standard runtime API available in Node and browsers; no DOM dependency.
declare const URL: { new(input: string): { protocol: string; username: string; password: string } };
type URL = InstanceType<typeof URL>;

export const MAX_VERSION_PART = 999999;
export const MAX_TITLE_CODE_POINTS = 80;
export const MAX_RATIONALE_CODE_POINTS = 4000;
const MAX_TICKET_URL_CHARS = 2048;

export type VersionBumpKind = 'major' | 'minor' | 'patch';

export type VersionSuggestion = {
  readonly kind: VersionBumpKind;
  readonly version: SemanticVersion;
  readonly versionKey: string;
  readonly disabled: boolean;
};

export type VersionSuggestions = {
  readonly isFirst: boolean;
  readonly proposed: SemanticVersion;
  readonly proposedKey: string;
  readonly suggestions: readonly VersionSuggestion[];
};

/**
 * Derives the canonical versionKey 'M.m.p' with no leading zeros.
 */
export function deriveVersionKey(version: SemanticVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Parses a versionKey into a SemanticVersion, or null if invalid or has leading zeros.
 */
export function parseVersionKey(versionKey: string): SemanticVersion | null {
  if (typeof versionKey !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(versionKey);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    !Number.isSafeInteger(major) ||
    major > MAX_VERSION_PART ||
    !Number.isSafeInteger(minor) ||
    minor > MAX_VERSION_PART ||
    !Number.isSafeInteger(patch) ||
    patch > MAX_VERSION_PART
  ) {
    return null;
  }
  return { major, minor, patch };
}

/**
 * Compares two SemanticVersions numerically (e.g. 0.10.0 > 0.9.9).
 * Returns a negative integer if a < b, 0 if a == b, or a positive integer if a > b.
 */
export function compareSemanticVersions(a: SemanticVersion, b: SemanticVersion): number {
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  return a.patch - b.patch;
}

/**
 * Validates PublicationMetadata:
 * - version parts: safe integers 0–999999
 * - title: trimmed 1–80 code points
 * - rationale: 0–4000 code points
 * - ticketUrl: null or absolute http(s) URL <= 2048 chars, no credentials, hostile schemes rejected
 */
export function validatePublicationMetadata(metadata: unknown): Issue[] {
  const issues: Issue[] = [];

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return [
      createIssue('wrong-type', 'Publication metadata must be an object', ['metadata']),
    ];
  }

  const m = metadata as Partial<PublicationMetadata>;

  // 1. Version validation
  if (!m.version || typeof m.version !== 'object' || Array.isArray(m.version)) {
    issues.push(
      createIssue('missing-property', 'metadata.version is required and must be an object', [
        'metadata',
        'version',
      ]),
    );
  } else {
    const v = m.version as Partial<SemanticVersion>;
    const parts: readonly (keyof SemanticVersion)[] = ['major', 'minor', 'patch'];
    for (const part of parts) {
      const val = v[part];
      if (typeof val !== 'number' || !Number.isSafeInteger(val)) {
        issues.push(
          createIssue(
            'wrong-type',
            `metadata.version.${part} must be a safe integer`,
            ['metadata', 'version', part],
          ),
        );
      } else if (val < 0 || val > MAX_VERSION_PART) {
        issues.push(
          createIssue(
            'out-of-range',
            `metadata.version.${part} must be between 0 and ${MAX_VERSION_PART}`,
            ['metadata', 'version', part],
          ),
        );
      }
    }
  }

  // 2. Title validation: trimmed, 1–80 code points
  if (typeof m.title !== 'string') {
    issues.push(
      createIssue('wrong-type', 'metadata.title must be a string', [
        'metadata',
        'title',
      ]),
    );
  } else {
    const trimmed = m.title.trim();
    const codePointLen = Array.from(trimmed).length;
    if (codePointLen < 1) {
      issues.push(
        createIssue(
          'out-of-range',
          'metadata.title must be at least 1 code point when trimmed',
          ['metadata', 'title'],
        ),
      );
    } else if (codePointLen > MAX_TITLE_CODE_POINTS) {
      issues.push(
        createIssue(
          'too-long',
          `metadata.title trimmed length (${codePointLen} code points) exceeds maximum of ${MAX_TITLE_CODE_POINTS}`,
          ['metadata', 'title'],
        ),
      );
    }
  }

  // 3. Rationale validation: 0–4000 code points
  if (typeof m.rationale !== 'string') {
    issues.push(
      createIssue('wrong-type', 'metadata.rationale must be a string', [
        'metadata',
        'rationale',
      ]),
    );
  } else {
    const codePointLen = Array.from(m.rationale).length;
    if (codePointLen > MAX_RATIONALE_CODE_POINTS) {
      issues.push(
        createIssue(
          'too-long',
          `metadata.rationale length (${codePointLen} code points) exceeds maximum of ${MAX_RATIONALE_CODE_POINTS}`,
          ['metadata', 'rationale'],
        ),
      );
    }
  }

  // 4. ticketUrl validation: null or absolute http(s) URL <= 2048 chars, no credentials, hostile schemes rejected
  if (m.ticketUrl !== null && m.ticketUrl !== undefined) {
    if (typeof m.ticketUrl !== 'string') {
      issues.push(
        createIssue('wrong-type', 'metadata.ticketUrl must be null or a string', [
          'metadata',
          'ticketUrl',
        ]),
      );
    } else {
      if (m.ticketUrl.length > MAX_TICKET_URL_CHARS) {
        issues.push(
          createIssue(
            'too-long',
            `metadata.ticketUrl length (${m.ticketUrl.length}) exceeds maximum of ${MAX_TICKET_URL_CHARS} characters`,
            ['metadata', 'ticketUrl'],
          ),
        );
      }

      let parsed: URL | null = null;
      try {
        parsed = new URL(m.ticketUrl);
      } catch {
        issues.push(
          createIssue(
            'structural-rule',
            'metadata.ticketUrl must be a valid absolute URL',
            ['metadata', 'ticketUrl'],
          ),
        );
      }

      if (parsed) {
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          issues.push(
            createIssue(
              'structural-rule',
              `metadata.ticketUrl scheme must be http: or https:, got '${parsed.protocol}'`,
              ['metadata', 'ticketUrl'],
            ),
          );
        }

        if (parsed.username !== '' || parsed.password !== '') {
          issues.push(
            createIssue(
              'structural-rule',
              'metadata.ticketUrl must not contain credentials (username or password)',
              ['metadata', 'ticketUrl'],
            ),
          );
        }
      }
    }
  } else if (m.ticketUrl === undefined) {
    issues.push(
      createIssue('missing-property', 'metadata.ticketUrl is required (string or null)', [
        'metadata',
        'ticketUrl',
      ]),
    );
  }

  return issues;
}

/**
 * Computes version suggestions:
 * - The first publication proposes 0.1.0.
 * - Later ones offer major/minor/patch bumps with resets:
 *   - Major bump resets minor and patch to 0.
 *   - Minor bump resets patch to 0.
 *   - An overflowing bump (> 999999) is marked disabled (never wrapped or clamped).
 */
export function proposeVersionSuggestions(
  latestVersion: SemanticVersion | null,
): VersionSuggestions {
  if (latestVersion === null) {
    const initial: SemanticVersion = { major: 0, minor: 1, patch: 0 };
    return {
      isFirst: true,
      proposed: initial,
      proposedKey: deriveVersionKey(initial),
      suggestions: [
        {
          kind: 'major',
          version: { major: 1, minor: 0, patch: 0 },
          versionKey: '1.0.0',
          disabled: false,
        },
        {
          kind: 'minor',
          version: initial,
          versionKey: '0.1.0',
          disabled: false,
        },
        {
          kind: 'patch',
          version: { major: 0, minor: 0, patch: 1 },
          versionKey: '0.0.1',
          disabled: false,
        },
      ],
    };
  }

  // Major bump resets minor and patch
  const majorVal = latestVersion.major + 1;
  const majorDisabled = majorVal > MAX_VERSION_PART;
  const majorVersion: SemanticVersion = {
    major: majorVal,
    minor: 0,
    patch: 0,
  };

  // Minor bump resets patch
  const minorVal = latestVersion.minor + 1;
  const minorDisabled = minorVal > MAX_VERSION_PART;
  const minorVersion: SemanticVersion = {
    major: latestVersion.major,
    minor: minorVal,
    patch: 0,
  };

  // Patch bump
  const patchVal = latestVersion.patch + 1;
  const patchDisabled = patchVal > MAX_VERSION_PART;
  const patchVersion: SemanticVersion = {
    major: latestVersion.major,
    minor: latestVersion.minor,
    patch: patchVal,
  };

  const suggestions: readonly VersionSuggestion[] = [
    {
      kind: 'patch',
      version: patchVersion,
      versionKey: deriveVersionKey(patchVersion),
      disabled: patchDisabled,
    },
    {
      kind: 'minor',
      version: minorVersion,
      versionKey: deriveVersionKey(minorVersion),
      disabled: minorDisabled,
    },
    {
      kind: 'major',
      version: majorVersion,
      versionKey: deriveVersionKey(majorVersion),
      disabled: majorDisabled,
    },
  ];

  // Pick default proposed suggestion: patch if enabled, else minor, else major, fallback patch
  let proposed = patchVersion;
  if (patchDisabled && !minorDisabled) {
    proposed = minorVersion;
  } else if (patchDisabled && minorDisabled && !majorDisabled) {
    proposed = majorVersion;
  }

  return {
    isFirst: false,
    proposed,
    proposedKey: deriveVersionKey(proposed),
    suggestions,
  };
}
