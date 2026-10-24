import { describe, expect, it } from 'vitest';
import { LOCAL_PROVIDER_CAPABILITIES, ProviderStreamNormalizer, type ProviderEvent, type LocalAgentProvider } from '@canvas-one/agent-bridge';

const line = (record: unknown) => JSON.stringify(record) + '\n';
const parser = (provider: LocalAgentProvider, maxRecordChars?: number) => new ProviderStreamNormalizer(provider, { taskId: 'task-1', attemptId: 'attempt-1' }, { maxRecordChars });
const payloads = (events: ProviderEvent[]) => events.map(event => event.payload);

describe('local provider stream normalization', () => {
  it('parses split and CRLF agy records, without exposing reasoning or cumulative duration as progress', () => {
    const p = parser('agy');
    const wire = line({ event: 'init', conversation_id: 'explicit-session' }) + line({ event: 'step_update', step_update: { step_type: 'agent_response', text_delta: 'Hello', duration_seconds: 315 } }) + line({ event: 'step_update', step_update: { step_type: 'thinking', text_delta: 'private thoughts' } }) + line({ event: 'result', result: { status: 'SUCCESS', response: 'Hello' } });
    const events = [...p.push(wire.slice(0, 23)), ...p.push(wire.slice(23).replaceAll('\n', '\r\n')), ...p.finish(0)];
    expect(payloads(events)).toEqual([
      { kind: 'session', sessionId: 'explicit-session' },
      { kind: 'text', text: 'Hello', format: 'delta' },
      { kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false },
      { kind: 'attempt-ended', outcome: 'succeeded', cancellationAcknowledged: false },
    ]);
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.every(event => event.taskId === 'task-1' && event.attemptId === 'attempt-1')).toBe(true);
  });

  it('classifies agy zero-exit SUCCESS with denied MCP and empty response as failed', () => {
    const p = parser('agy');
    const events = [...p.push(line({ event: 'result', result: { status: 'SUCCESS', response: '', denied_actions: [{ action: 'mcp', display_name: 'CallMcpTool' }] } })), ...p.finish(0)];
    expect(payloads(events)).toContainEqual({ kind: 'diagnostic', code: 'tool-denied', message: 'Provider denied one or more tool actions' });
    expect(events.at(-1)?.payload).toEqual({ kind: 'attempt-ended', outcome: 'failed', cancellationAcknowledged: false });
  });

  it('emits each agy tool start once and ignores missing/unsafe IDs or unknown states', () => {
    const p = parser('agy');
    const step = (step_index: unknown, state: string) => line({ event: 'step_update', step_update: { step_type: 'tool', step_index, state, tool_name: 'call_mcp_tool' } });
    const events = p.push(step(undefined, 'ACTIVE') + step(-1, 'ACTIVE') + step(1.5, 'ACTIVE') + step(Number.MAX_SAFE_INTEGER + 1, 'ACTIVE') + step(1, 'UNKNOWN') + step(1, 'ACTIVE') + step(1, 'ACTIVE') + step(1, 'DONE') + step(1, 'ACTIVE') + step(1, 'DONE'));
    expect(payloads(events)).toEqual([
      { kind: 'tool', toolId: '1', name: 'call_mcp_tool', phase: 'started' },
      { kind: 'tool', toolId: '1', name: 'call_mcp_tool', phase: 'completed' },
    ]);
  });

  it('retains agy tool failure/cancellation despite a later SUCCESS result', () => {
    for (const state of ['FAILED', 'CANCELLED']) {
      const p = parser('agy');
      const events = [...p.push(line({ event: 'step_update', step_update: { step_type: 'tool', step_index: 2, state, tool_name: 'call_mcp_tool' } }) + line({ event: 'result', result: { status: 'SUCCESS', response: 'Done' } })), ...p.finish(0)];
      expect(payloads(events)).toContainEqual({ kind: 'tool', toolId: '2', name: 'call_mcp_tool', phase: 'failed' });
      expect(events.at(-1)?.payload).toMatchObject({ outcome: 'failed', cancellationAcknowledged: false });
    }
  });

  it('bounds agy tool tracking without inventing an event for an untracked tool', () => {
    const p = parser('agy');
    const events = p.push(Array.from({ length: 257 }, (_, index) => line({ event: 'step_update', step_update: { step_type: 'tool', step_index: index, state: 'ACTIVE', tool_name: 'call_mcp_tool' } })).join(''));
    expect(payloads(events).filter(event => event.kind === 'tool')).toHaveLength(256);
    expect(events.at(-1)?.payload).toMatchObject({ kind: 'diagnostic', code: 'record-too-large' });
  });

  it('does not duplicate Claude full message after text deltas or expose thinking deltas', () => {
    const p = parser('claude');
    const records = [
      { type: 'system', subtype: 'init', session_id: 'claude-session' },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'private' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } } },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Done', permission_denials: [] },
    ];
    const events = [...p.push(records.map(line).join('')), ...p.finish(0)];
    expect(payloads(events).filter(event => event.kind === 'text')).toEqual([{ kind: 'text', text: 'Done', format: 'delta' }]);
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'succeeded' });
  });

  it('requires Claude terminal success and includes permission denials despite is_error false', () => {
    const p = parser('claude');
    const events = [...p.push(line({ type: 'result', subtype: 'success', is_error: false, permission_denials: [{ tool_name: 'mcp__board' }] })), ...p.finish(0)];
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'failed' });
    const malformed = parser('claude');
    expect([...malformed.push(line({ type: 'result' })), ...malformed.finish(0)].at(-1)?.payload).toMatchObject({ outcome: 'failed' });
  });

  it('tracks Claude observed tool results and avoids duplicate starts from partial/full records', () => {
    const p = parser('claude');
    const block = { type: 'tool_use', id: 'tool-1', name: 'mcp__fixture__proposal_submit', input: {} };
    const events = [...p.push([
      { type: 'stream_event', event: { type: 'content_block_start', content_block: block } },
      { type: 'assistant', message: { content: [block] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: 'Denied' }] } },
      { type: 'result', subtype: 'success', is_error: false, result: 'Could not submit' },
    ].map(line).join('')), ...p.finish(0)];
    expect(payloads(events).filter(event => event.kind === 'tool')).toEqual([
      { kind: 'tool', toolId: 'tool-1', name: block.name, phase: 'started' },
      { kind: 'tool', toolId: 'tool-1', name: block.name, phase: 'failed' },
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'failed' });
  });

  it('handles Codex exec tool lifecycle without treating nonfatal item warnings as turn failures', () => {
    const p = parser('codex');
    const events = [...p.push([
      { type: 'thread.started', thread_id: 'codex-thread' },
      { type: 'item.completed', item: { id: 'warning', type: 'error', message: 'Skill descriptions shortened' } },
      { type: 'item.started', item: { id: 'tool-1', type: 'mcp_tool_call', tool: 'board_inspect', status: 'in_progress', error: null } },
      { type: 'item.completed', item: { id: 'tool-1', type: 'mcp_tool_call', tool: 'board_inspect', status: 'completed', result: { content: [] }, error: null } },
      { type: 'item.completed', item: { id: 'reply', type: 'agent_message', text: 'Pending proposal' } },
      { type: 'turn.completed', usage: {} },
    ].map(line).join('')), ...p.finish(0)];
    expect(payloads(events).filter(event => event.kind === 'tool')).toEqual([
      { kind: 'tool', toolId: 'tool-1', name: 'board_inspect', phase: 'started' },
      { kind: 'tool', toolId: 'tool-1', name: 'board_inspect', phase: 'completed' },
    ]);
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'succeeded' });
  });

  it('retains Codex tool failure even if the provider completes the turn', () => {
    const p = parser('codex');
    const events = [...p.push(line({ type: 'item.completed', item: { id: 'tool', type: 'mcp_tool_call', tool: 'proposal_submit', status: 'failed', error: 'Approval policy never' } }) + line({ type: 'turn.completed' })), ...p.finish(0)];
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'failed' });
  });

  it('does not infer cancellation acknowledgement from a signal, missing terminal record or zero exit', () => {
    for (const exitCode of [0, null, 143]) {
      const p = parser('codex');
      p.push(line({ type: 'thread.started', thread_id: 'thread' }));
      expect(p.finish(exitCode).at(-1)?.payload).toEqual({ kind: 'attempt-ended', outcome: 'failed', cancellationAcknowledged: false });
    }
  });

  it('waits for process exit before final attempt success and rejects nonzero exit after provider success', () => {
    const p = parser('codex');
    expect(payloads(p.push(line({ type: 'turn.completed' })))).toEqual([{ kind: 'provider-result', outcome: 'succeeded', cancellationAcknowledged: false }]);
    expect(p.finish(1).at(-1)?.payload).toMatchObject({ kind: 'attempt-ended', outcome: 'failed' });
    expect(p.finish(0)).toEqual([]);
    expect(() => p.push('')).toThrow('closed');
  });

  it('recovers record boundaries after malformed and oversized records while preserving failure', () => {
    const p = parser('codex', 128);
    const events = [...p.push('not json\n'), ...p.push('x'.repeat(129)), ...p.push('x'.repeat(1000) + '\n' + line({ type: 'turn.completed' })), ...p.finish(0)];
    expect(payloads(events).filter(event => event.kind === 'diagnostic').map(event => event.code)).toEqual(['malformed-record', 'record-too-large']);
    expect(events.at(-1)?.payload).toMatchObject({ outcome: 'failed' });
  });

  it('handles a final record without newline and rejects truncated JSON without leaking raw data', () => {
    const p = parser('codex');
    p.push(JSON.stringify({ type: 'turn.completed' }));
    expect(p.finish(0).at(-1)?.payload).toMatchObject({ outcome: 'succeeded' });
    const truncated = parser('agy');
    truncated.push('{"secret":"sensitive');
    const result = truncated.finish(0);
    expect(JSON.stringify(result)).not.toContain('sensitive');
    expect(result.at(-1)?.payload).toMatchObject({ outcome: 'failed' });
  });

  it('keeps verified continuation separate from unverified recovery and blocked agy tools', () => {
    expect(LOCAL_PROVIDER_CAPABILITIES.agy.boardToolTransport).toBe('blocked');
    expect(LOCAL_PROVIDER_CAPABILITIES.codex.protocol).toBe('codex-exec-json');
    for (const capability of Object.values(LOCAL_PROVIDER_CAPABILITIES)) {
      expect(capability.explicitSessionContinuation).toBe('verified-fixture');
      expect(capability.interruptedRecovery).toBe('unverified');
      expect(capability.activeFeedback).toBe('unverified');
      expect(capability.cancellationAcknowledgement).toBe('unverified');
    }
    expect(() => new ProviderStreamNormalizer('claude', { taskId: '', attemptId: 'attempt' })).toThrow();
    expect(() => parser('claude', 1024 * 1024 + 1)).toThrow();
  });
});
