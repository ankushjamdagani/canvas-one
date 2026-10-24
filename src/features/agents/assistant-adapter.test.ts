import { describe, expect, it } from 'vitest';
import { safeMarkdownUrl, toAssistantMessage } from './AssistantConversation';

describe('Canvas conversation runtime adapter', () => {
  it('retains saved identity, attribution and streamed text without generating optimistic messages', () => {
    const message = { id: 'saved-message', taskId: 'task', attemptId: 'attempt', author: 'Claude', kind: 'agent' as const, text: 'Preparing' };
    const first = toAssistantMessage(message);
    const streamed = toAssistantMessage({ ...message, text: 'Preparing changes' });
    expect(first.id).toBe('saved-message');
    expect(streamed.id).toBe(first.id);
    expect(streamed.metadata?.custom).toEqual({ author: 'Claude', taskId: 'task', attemptId: 'attempt' });
    expect(streamed.content).toEqual([{ type: 'text', text: 'Preparing changes' }]);
  });
  it('retains user roles and permits paging by stable persisted message identities', () => {
    const user = { id: 'recent', author: 'You', kind: 'user' as const, text: 'Rename' };
    const before = toAssistantMessage(user);
    const paged = [{ ...user, id: 'older' }, user].map(toAssistantMessage);
    expect(paged[1]).toEqual(before);
    expect(before.role).toBe('user');
  });
  it('allows explicit web/mail links and local paths but rejects executable and protocol-relative URLs', () => {
    for (const url of ['https://example.com', 'http://localhost:3001', 'mailto:user@example.com', '/project/example', '#heading']) expect(safeMarkdownUrl(url)).toBe(url);
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//external.example', ' javascript:alert(1)', '/\\external.example', '\\\\external.example', '/%5Cexternal.example', 'java\tscript:alert(1)']) expect(safeMarkdownUrl(url)).toBe('');
  });
});
