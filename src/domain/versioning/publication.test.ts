import { describe, expect, it } from 'vitest';
import {
  compareSemanticVersions,
  deriveVersionKey,
  parseVersionKey,
  proposeVersionSuggestions,
  validatePublicationMetadata,
  MAX_RATIONALE_CODE_POINTS,
  MAX_TITLE_CODE_POINTS,
  MAX_VERSION_PART,
} from './publication';
import type { PublicationMetadata } from '../../persistence/studio/types';

describe('Publication Metadata and Version Helpers (RV-08e)', () => {
  const validMetadata: PublicationMetadata = {
    version: { major: 0, minor: 1, patch: 0 },
    title: 'Initial publication',
    rationale: 'First release of system architecture',
    ticketUrl: 'https://example.com/tickets/SYS-101',
  };

  describe('validatePublicationMetadata', () => {
    it('accepts completely valid metadata', () => {
      const issues = validatePublicationMetadata(validMetadata);
      expect(issues).toHaveLength(0);
    });

    it('accepts ticketUrl as null', () => {
      const issues = validatePublicationMetadata({
        ...validMetadata,
        ticketUrl: null,
      });
      expect(issues).toHaveLength(0);
    });

    it('rejects non-object metadata', () => {
      expect(validatePublicationMetadata(null)).toHaveLength(1);
      expect(validatePublicationMetadata('bad')).toHaveLength(1);
      expect(validatePublicationMetadata([validMetadata])).toHaveLength(1);
    });

    describe('version part bounds (0–999999 safe integers)', () => {
      it('accepts boundary values 0 and 999999', () => {
        expect(
          validatePublicationMetadata({
            ...validMetadata,
            version: { major: 0, minor: 0, patch: 0 },
          }),
        ).toHaveLength(0);

        expect(
          validatePublicationMetadata({
            ...validMetadata,
            version: {
              major: MAX_VERSION_PART,
              minor: MAX_VERSION_PART,
              patch: MAX_VERSION_PART,
            },
          }),
        ).toHaveLength(0);
      });

      it('rejects negative version parts', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          version: { major: -1, minor: 0, patch: 0 },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('out-of-range');
        expect(issues[0].path).toEqual(['metadata', 'version', 'major']);
      });

      it('rejects overflowing version parts (> 999999)', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          version: { major: 0, minor: 1_000_000, patch: 0 },
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('out-of-range');
        expect(issues[0].path).toEqual(['metadata', 'version', 'minor']);
      });

      it('rejects non-safe-integer or float version parts', () => {
        const floatIssues = validatePublicationMetadata({
          ...validMetadata,
          version: { major: 1.5, minor: 0, patch: 0 },
        });
        expect(floatIssues).toHaveLength(1);
        expect(floatIssues[0].code).toBe('wrong-type');

        const nanIssues = validatePublicationMetadata({
          ...validMetadata,
          version: { major: NaN, minor: 0, patch: 0 },
        });
        expect(nanIssues).toHaveLength(1);
        expect(nanIssues[0].code).toBe('wrong-type');
      });

      it('rejects missing version object', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          version: undefined as any,
        });
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].code).toBe('missing-property');
      });
    });

    describe('title bounds (trimmed 1–80 code points)', () => {
      it('accepts trimmed title of 1 code point and 80 code points', () => {
        expect(
          validatePublicationMetadata({
            ...validMetadata,
            title: 'a',
          }),
        ).toHaveLength(0);

        expect(
          validatePublicationMetadata({
            ...validMetadata,
            title: 'x'.repeat(MAX_TITLE_CODE_POINTS),
          }),
        ).toHaveLength(0);

        // Surrounding whitespace is trimmed
        expect(
          validatePublicationMetadata({
            ...validMetadata,
            title: '  ' + 'x'.repeat(MAX_TITLE_CODE_POINTS) + '  ',
          }),
        ).toHaveLength(0);
      });

      it('rejects empty or whitespace-only title', () => {
        const emptyIssues = validatePublicationMetadata({
          ...validMetadata,
          title: '',
        });
        expect(emptyIssues).toHaveLength(1);
        expect(emptyIssues[0].code).toBe('out-of-range');

        const wsIssues = validatePublicationMetadata({
          ...validMetadata,
          title: '    ',
        });
        expect(wsIssues).toHaveLength(1);
        expect(wsIssues[0].code).toBe('out-of-range');
      });

      it('rejects title longer than 80 code points', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          title: 'x'.repeat(MAX_TITLE_CODE_POINTS + 1),
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('too-long');
      });

      it('correctly handles multi-byte Unicode code points (emojis)', () => {
        // An emoji like 🚀 is 2 UTF-16 code units but 1 code point
        const emoji80 = '🚀'.repeat(MAX_TITLE_CODE_POINTS);
        expect(Array.from(emoji80).length).toBe(80);
        expect(emoji80.length).toBe(160); // 160 UTF-16 units

        expect(
          validatePublicationMetadata({
            ...validMetadata,
            title: emoji80,
          }),
        ).toHaveLength(0);

        const emoji81 = '🚀'.repeat(MAX_TITLE_CODE_POINTS + 1);
        const issues = validatePublicationMetadata({
          ...validMetadata,
          title: emoji81,
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('too-long');
      });
    });

    describe('rationale bounds (0–4000 code points)', () => {
      it('accepts empty rationale and 4000-character rationale', () => {
        expect(
          validatePublicationMetadata({
            ...validMetadata,
            rationale: '',
          }),
        ).toHaveLength(0);

        expect(
          validatePublicationMetadata({
            ...validMetadata,
            rationale: 'r'.repeat(MAX_RATIONALE_CODE_POINTS),
          }),
        ).toHaveLength(0);
      });

      it('rejects rationale exceeding 4000 code points', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          rationale: 'r'.repeat(MAX_RATIONALE_CODE_POINTS + 1),
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('too-long');
      });

      it('rejects non-string rationale', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          rationale: 123 as any,
        });
        expect(issues).toHaveLength(1);
        expect(issues[0].code).toBe('wrong-type');
      });
    });

    describe('ticketUrl bounds and validation', () => {
      it('accepts valid http and https absolute URLs', () => {
        expect(
          validatePublicationMetadata({
            ...validMetadata,
            ticketUrl: 'http://example.com/ticket/1',
          }),
        ).toHaveLength(0);

        expect(
          validatePublicationMetadata({
            ...validMetadata,
            ticketUrl: 'https://jira.corp.internal/browse/SYS-999',
          }),
        ).toHaveLength(0);
      });

      it('rejects relative URLs or unparseable URLs', () => {
        const issues = validatePublicationMetadata({
          ...validMetadata,
          ticketUrl: '/tickets/SYS-101',
        });
        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].code).toBe('structural-rule');
      });

      it('rejects ticketUrl exceeding 2048 characters', () => {
        const longPath = 'a'.repeat(2040);
        const longUrl = `https://example.com/${longPath}`;
        expect(longUrl.length).toBeGreaterThan(2048);

        const issues = validatePublicationMetadata({
          ...validMetadata,
          ticketUrl: longUrl,
        });
        expect(issues.some((i) => i.code === 'too-long')).toBe(true);
      });

      it('rejects hostile schemes: javascript:, data:, file:, ftp:', () => {
        const hostileUrls = [
          'javascript:alert(1)',
          'javascript://test%0Aalert(1)',
          'data:text/html,<script>alert(1)</script>',
          'file:///etc/passwd',
          'ftp://ftp.example.com/file',
        ];

        for (const url of hostileUrls) {
          const issues = validatePublicationMetadata({
            ...validMetadata,
            ticketUrl: url,
          });
          expect(issues.length).toBeGreaterThan(0);
          expect(
            issues.some(
              (i) => i.code === 'structural-rule' && i.message.includes('scheme must be http: or https:'),
            ),
          ).toBe(true);
        }
      });

      it('rejects credentials in ticketUrl (username or password)', () => {
        const credentialUrls = [
          'https://user:password@example.com/ticket',
          'https://user@example.com/ticket',
          'https://:password@example.com/ticket',
          'http://admin:secret@jira.internal/',
        ];

        for (const url of credentialUrls) {
          const issues = validatePublicationMetadata({
            ...validMetadata,
            ticketUrl: url,
          });
          expect(issues.length).toBeGreaterThan(0);
          expect(
            issues.some(
              (i) => i.code === 'structural-rule' && i.message.includes('must not contain credentials'),
            ),
          ).toBe(true);
        }
      });
    });
  });

  describe('deriveVersionKey and parseVersionKey', () => {
    it('derives versionKey as M.m.p with no leading zeros', () => {
      expect(deriveVersionKey({ major: 0, minor: 1, patch: 0 })).toBe('0.1.0');
      expect(deriveVersionKey({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
      expect(deriveVersionKey({ major: 0, minor: 10, patch: 0 })).toBe('0.10.0');
      expect(deriveVersionKey({ major: 10, minor: 0, patch: 5 })).toBe('10.0.5');
    });

    it('parses valid versionKeys without leading zeros', () => {
      expect(parseVersionKey('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
      expect(parseVersionKey('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
      expect(parseVersionKey('0.10.0')).toEqual({ major: 0, minor: 10, patch: 0 });
    });

    it('rejects versionKeys with leading zeros', () => {
      expect(parseVersionKey('01.0.0')).toBeNull();
      expect(parseVersionKey('0.01.0')).toBeNull();
      expect(parseVersionKey('0.0.01')).toBeNull();
      expect(parseVersionKey('00.0.0')).toBeNull();
      expect(parseVersionKey('v1.0.0')).toBeNull();
      expect(parseVersionKey('1.0.0-beta')).toBeNull();
    });
  });

  describe('compareSemanticVersions', () => {
    it('orders 0.10.0 > 0.9.9 numerically', () => {
      const v0100 = { major: 0, minor: 10, patch: 0 };
      const v099 = { major: 0, minor: 9, patch: 9 };
      expect(compareSemanticVersions(v0100, v099)).toBeGreaterThan(0);
      expect(compareSemanticVersions(v099, v0100)).toBeLessThan(0);
    });

    it('compares major, minor, and patch in significance order', () => {
      expect(
        compareSemanticVersions(
          { major: 1, minor: 0, patch: 0 },
          { major: 0, minor: 999999, patch: 999999 },
        ),
      ).toBeGreaterThan(0);

      expect(
        compareSemanticVersions(
          { major: 1, minor: 2, patch: 0 },
          { major: 1, minor: 1, patch: 99 },
        ),
      ).toBeGreaterThan(0);

      expect(
        compareSemanticVersions(
          { major: 1, minor: 2, patch: 5 },
          { major: 1, minor: 2, patch: 4 },
        ),
      ).toBeGreaterThan(0);

      expect(
        compareSemanticVersions(
          { major: 1, minor: 2, patch: 3 },
          { major: 1, minor: 2, patch: 3 },
        ),
      ).toBe(0);
    });
  });

  describe('proposeVersionSuggestions', () => {
    it('proposes 0.1.0 for the first publication', () => {
      const result = proposeVersionSuggestions(null);
      expect(result.isFirst).toBe(true);
      expect(result.proposed).toEqual({ major: 0, minor: 1, patch: 0 });
      expect(result.proposedKey).toBe('0.1.0');
      expect(result.suggestions.every((s) => !s.disabled)).toBe(true);
    });

    it('offers major, minor, and patch bumps with resets for later publications', () => {
      const current = { major: 1, minor: 2, patch: 3 };
      const result = proposeVersionSuggestions(current);

      expect(result.isFirst).toBe(false);

      const major = result.suggestions.find((s) => s.kind === 'major')!;
      expect(major.version).toEqual({ major: 2, minor: 0, patch: 0 }); // resets minor and patch
      expect(major.versionKey).toBe('2.0.0');
      expect(major.disabled).toBe(false);

      const minor = result.suggestions.find((s) => s.kind === 'minor')!;
      expect(minor.version).toEqual({ major: 1, minor: 3, patch: 0 }); // resets patch
      expect(minor.versionKey).toBe('1.3.0');
      expect(minor.disabled).toBe(false);

      const patch = result.suggestions.find((s) => s.kind === 'patch')!;
      expect(patch.version).toEqual({ major: 1, minor: 2, patch: 4 });
      expect(patch.versionKey).toBe('1.2.4');
      expect(patch.disabled).toBe(false);

      // Default proposed is the patch bump
      expect(result.proposed).toEqual({ major: 1, minor: 2, patch: 4 });
      expect(result.proposedKey).toBe('1.2.4');
    });

    it('marks overflowing bumps disabled without wrapping or clamping', () => {
      const atMax = { major: MAX_VERSION_PART, minor: MAX_VERSION_PART, patch: MAX_VERSION_PART };
      const result = proposeVersionSuggestions(atMax);

      const major = result.suggestions.find((s) => s.kind === 'major')!;
      expect(major.disabled).toBe(true);
      // Mathematical value is 1000000; never wrapped to 0 or clamped to 999999
      expect(major.version.major).toBe(1_000_000);
      expect(major.versionKey).toBe('1000000.0.0');

      const minor = result.suggestions.find((s) => s.kind === 'minor')!;
      expect(minor.disabled).toBe(true);
      expect(minor.version.minor).toBe(1_000_000);

      const patch = result.suggestions.find((s) => s.kind === 'patch')!;
      expect(patch.disabled).toBe(true);
      expect(patch.version.patch).toBe(1_000_000);
    });
  });
});
