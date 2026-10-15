import * as React from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { CollaborationPanel, type CollaborationPanelProps, type CollaborationIntent } from './CollaborationPanel';

type State = 'disconnected' | 'review' | 'overlap' | 'interrupted' | 'mobile' | 'composer' | 'historical-conflict' | 'older-window' | 'provider-unavailable';

/** Fixtures exercise presentation only; clicking a command records it without running an agent. */
function Fixture({ state, narrow = false }: { readonly state: State; readonly narrow?: boolean }) {
  const [text, setText] = React.useState('');
  const [intent, setIntent] = React.useState<CollaborationIntent>('task');
  const [action, setAction] = React.useState('');
  const [dismissed, setDismissed] = React.useState(false);
  const [earlierWindow, setEarlierWindow] = React.useState(true);
  const record = (label: string) => () => setAction(`Preview action: ${label}`);
  const props: { -readonly [Key in keyof CollaborationPanelProps]: CollaborationPanelProps[Key] } = {
    provider: 'claude',
    providers: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }, { id: 'agy', label: 'agy' }],
    onProviderChange: provider => setAction(`Preview agent selection: ${provider}`),
    connection: state === 'mobile' ? { status: 'desktop-required' }
      : state === 'disconnected' ? { status: 'disconnected', onSetup: record('connection settings') }
      : { status: 'connected', onDisconnect: record('disconnect') },
    messages: state === 'review' ? Array.from({ length: 35 }, (_, index) => ({ id: `message-${index}`, kind: 'agent' as const, author: 'Claude', text: `Review observation ${index + 1}: the proposed queue separates checkout from fulfilment. This is fixture content for testing long conversation scrolling.` })) : [],
    composer: {
      text, intent, onTextChange: setText, onIntentChange: setIntent,
      context: [{ id: 'checkout', label: 'Checkout service' }],
      targetLabel: state === 'review' ? 'Proposal P-14.1' : undefined,
      disabledReason: state === 'interrupted' ? 'Resume or end the interrupted task before assigning new work.' : undefined,
      onSend: record('send'), onAddSelection: record('add selection'),
    },
    history: state === 'review' ? Array.from({ length: 10 }, (_, index) => ({ id: `history-${index}`, title: `Earlier task ${index + 1}`, outcome: 'Completed · changes retained', onOpen: record(`inspect earlier task ${index + 1}`) })) : [],
  };
  if (state === 'review') {
    props.task = { id: 'T-14', title: 'Decouple checkout and fulfilment', status: 'Waiting for review', permission: 'suggest', context: 'Checkout service', expression: 'reply', onStop: record('stop') };
    props.review = {
      id: 'P-14.1', title: 'Add an asynchronous fulfilment path', status: 'ready',
      changes: [{ id: 'queue', kind: 'add', label: 'Fulfilment queue', detail: 'New queue between checkout and fulfilment.' }, { id: 'sync', kind: 'remove', label: 'Synchronous fulfilment connection', detail: 'Removed content remains available in the before-state comparison.' }],
      onAccept: record('accept coherent proposal'), onReject: record('reject'), onRequestChanges: () => { setIntent('feedback'); setAction('Preview action: request changes'); }, onFitChanges: record('fit changes'),
    };
  }
  if (state === 'historical-conflict') {
    props.task = { id: 'old-task', title: 'Earlier failed task', status: 'failed', permission: 'suggest', context: 'Whole board' };
    props.historyContent = <p>Historical accepted proposals remain read only. This older task still has an unresolved review.</p>;
    props.review = { id: 'old-conflict', title: 'Pending review from earlier task', status: dismissed ? 'rejected' : 'stale', changes: [{ id: 'queue', kind: 'change', label: 'Queue', detail: 'The board changed before review.' }], rejectLabel: 'Dismiss pending review', onReject: dismissed ? undefined : () => { setDismissed(true); setAction('Preview action: dismissed pending review'); } };
  }
  if (state === 'older-window') {
    props.historyWindowGap = earlierWindow;
    props.onReturnToRecentMessages = () => { setEarlierWindow(false); setAction('Preview action: return to recent messages'); };
    props.messages = [{ id: 'older-message', kind: 'agent', author: 'Claude', text: 'Earlier saved conversation content.' }];
    props.awaitingAnswers = [{ id: 'archived-question', author: 'Claude', text: 'Which queue should I use?', onReply: record('answer archived question') }];
  }
  if (state === 'provider-unavailable') {
    props.providers = [{ id: 'claude', label: 'Claude', unavailableReason: 'Claude CLI is not installed.' }, { id: 'codex', label: 'Codex' }, { id: 'agy', label: 'agy' }];
    props.composer = { ...props.composer, text: 'Add a queue' };
  }
  if (state === 'overlap') {
    props.task = { id: 'T-16', title: 'Replace stock sync with an inventory cache', status: 'Affected action paused', activity: 'Your edit changed the connection being updated.', permission: 'live', context: 'Stock sync job', expression: 'wait', onStop: record('stop') };
    props.messages = [{ id: 'overlap', author: 'Claude', kind: 'activity', text: 'The pending connection update needs your decision. Your current connection remains unchanged.' }];
    props.composer = { ...props.composer, disabledReason: 'Resolve the affected action through the host conflict review.' };
  }
  if (state === 'interrupted') {
    props.task = { id: 'T-17', title: 'Document failure paths', status: 'Interrupted', permission: 'suggest', context: 'Whole board', expression: 'wait', interruptedSummary: 'The board session ended. A completed proposal is still available for inspection; unfinished work has not restarted.', cancellation: 'Board writes are disabled. Resume requires current-board validation.', onResume: record('resume'), onEnd: record('end task') };
  }
  if (state === 'composer') {
    props.task = { id: 'T-18', attemptId: 'attempt-18', title: 'Explain the failure path', status: 'Working', permission: 'suggest', context: 'Checkout service', onStop: record('stop'), onRequestLivePermission: (taskId, attemptId) => setAction(`Preview grant request: ${taskId} / ${attemptId}`) };
  }
  return <div className="space-y-2" style={{ width: narrow ? 320 : 380, maxWidth: '100%' }}>
    <p className="text-caption text-secondary-text">Presentation fixture · no agent or board writes</p>
    <div className="h-[640px] min-h-0 overflow-hidden border border-hairline"><CollaborationPanel {...props} /></div>
    <p role="status" className="text-caption">{action || 'No preview action selected.'}</p>
  </div>;
}

const meta = { title: 'AI Collaboration/Current states', component: CollaborationPanel, parameters: { layout: 'padded' } } satisfies Meta<typeof CollaborationPanel>;
export default meta;
type Story = StoryObj;

export const Disconnected: Story = { render: () => <Fixture state="disconnected" /> };
export const SelectedProviderUnavailable: Story = {
  render: () => <Fixture state="provider-unavailable" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'Task instruction' })).toHaveValue('Add a queue');
    await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
    await expect(canvas.getByText('Claude CLI is not installed.')).toBeVisible();
  },
};
export const EarlierHistoryWindow: Story = {
  render: () => <Fixture state="older-window" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Showing an earlier history window; some newer messages are outside this view.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Return to recent messages' }));
    await expect(canvas.queryByRole('region', { name: 'Earlier history window' })).toBeNull();
    await expect(canvas.getByText('Preview action: return to recent messages')).toBeVisible();
    await expect(canvas.getByRole('region', { name: 'Awaiting your answer' })).toBeVisible();
    await expect(within(canvas.getByRole('list', { name: 'Messages' })).queryByText('Which queue should I use?')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'Answer this question' }));
    await expect(canvas.getByText('Preview action: answer archived question')).toBeVisible();
  },
};
export const HistoricalConflict: Story = {
  render: () => <Fixture state="historical-conflict" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'Accept changes' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss pending review' }));
    await expect(canvas.getByText('Preview action: dismissed pending review')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'Dismiss pending review' })).toBeNull();
  },
};
export const SuggestReview: Story = {
  render: () => <Fixture state="review" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const scroll = canvas.getByRole('region', { name: 'Conversation and proposed changes' });
    const actions = canvas.getByRole('button', { name: 'Accept changes' });
    const input = canvas.getByRole('textbox', { name: 'Task instruction' });
    const before = actions.getBoundingClientRect().top;
    scroll.scrollTop = scroll.scrollHeight;
    await expect(actions.getBoundingClientRect().top).toBe(before);
    await expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
    await expect(scroll.clientHeight).toBeGreaterThanOrEqual(120);
    await expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(canvas.getByTestId('collaboration-panel').getBoundingClientRect().bottom);
    await userEvent.click(canvas.getByRole('button', { name: 'Request changes' }));
    await expect(canvas.getByRole('textbox', { name: 'Feedback' })).toBeEnabled();
    await expect(scroll.clientHeight).toBeGreaterThanOrEqual(120);
  },
};
export const Overlap: Story = { render: () => <Fixture state="overlap" /> };
export const Interrupted: Story = { render: () => <Fixture state="interrupted" /> };
export const MobileDesktopRequired: Story = {
  render: () => <Fixture state="mobile" narrow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const panel = canvas.getByTestId('collaboration-panel');
    await expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    await expect(canvas.getByRole('textbox', { name: 'Task instruction' })).toBeDisabled();
    if (window.innerWidth < 640) {
      for (const control of panel.querySelectorAll('button, select')) {
        await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        await expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      }
    }
  },
};
export const KeyboardComposer: Story = {
  render: () => <Fixture state="composer" narrow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByRole('textbox', { name: 'Task instruction' });
    await userEvent.click(input);
    await userEvent.type(input, 'Explain the failure path');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await expect(canvas.getByText('Preview action: send')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Allow live edit for this task…' }));
    await expect(canvas.getByText('Preview grant request: T-18 / attempt-18')).toBeVisible();
    const panel = canvas.getByTestId('collaboration-panel');
    await expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
    await expect(input.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
    if (window.innerWidth < 640) {
      for (const control of panel.querySelectorAll('button, select')) {
        await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
    }
  },
};
