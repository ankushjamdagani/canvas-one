import { describe, expect, it } from 'vitest';
import { requireResultMessage, ResultMessageContractError } from './resultMessage';

describe('history result messages', () => {
  it('preserves actual issue and exception messages', () => {
    expect(requireResultMessage({ issues: [{ message: 'Source is closed' }] })).toBe('Source is closed');
    expect(requireResultMessage(new Error('Storage unavailable'))).toBe('Storage unavailable');
  });
  it.each([null, undefined, {}, { issues: [] }, { issues: [null] }, { message: '' }, ''])(
    'throws for a missing message: %j',
    (result) => {
      expect(() => requireResultMessage(result)).toThrow(ResultMessageContractError);
    },
  );
});
