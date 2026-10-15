import * as React from 'react';
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useAuiState, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { MarkdownTextPrimitive, type CodeHeaderProps } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '../../components/ui/button';
import type { CollaborationMessage, CollaborationPanelProps } from './CollaborationPanel';

export function toAssistantMessage(message: CollaborationMessage): ThreadMessageLike {
  return { id: message.id, role: message.kind === 'user' ? 'user' : 'assistant', content: [{ type: 'text', text: message.text }], metadata: { custom: { author: message.author, taskId: message.taskId ?? null, attemptId: message.attemptId ?? null } } };
}

export function safeMarkdownUrl(url: string): string {
  if (/[\\\u0000-\u0020\u007f]/.test(url) || /%5c/i.test(url)) return '';
  return /^(https?:|mailto:)/i.test(url) || /^(\/|#)/.test(url) && !url.startsWith('//') ? url : '';
}

function CodeHeader({ language, code }: CodeHeaderProps) {
  const [copied, setCopied] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { if (!copied && !failed) return; const timer = setTimeout(() => { setCopied(false); setFailed(false); }, 2000); return () => clearTimeout(timer); }, [copied, failed]);
  const copy = async () => { try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(code); setCopied(true); setFailed(false); } catch { setCopied(false); setFailed(true); } };
  return <div className="flex items-center justify-between gap-2 border-b border-hairline px-2 py-1"><span className="text-secondary-text">{language || 'Code'}</span><Button type="button" size="sm" variant="ghost" onClick={() => { void copy(); }}>{failed ? 'Copy unavailable' : copied ? 'Copied' : 'Copy code'}</Button></div>;
}

export function AssistantMarkdown() {
  return <div className="min-w-0 space-y-2 break-words [&_p]:whitespace-pre-wrap [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:p-2 [&_table]:w-full [&_td]:border [&_td]:border-hairline [&_td]:p-1 [&_th]:border [&_th]:border-hairline [&_th]:p-1 [&_a]:underline"><MarkdownTextPrimitive skipHtml remarkPlugins={[remarkGfm]} urlTransform={safeMarkdownUrl} components={{ img: ({ alt }) => <span className="text-secondary-text">[Image: {alt || 'not loaded'}]</span>, a: ({ href, children }) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>, CodeHeader }} /></div>;
}

export function AssistantMessage() {
  const author = useAuiState(state => state.message.metadata.custom.author as string | undefined);
  return <MessagePrimitive.Root asChild><li className="min-w-0 text-caption"><p className="mb-1 font-medium">{author}</p><MessagePrimitive.Parts components={{ Text: AssistantMarkdown }} /></li></MessagePrimitive.Root>;
}

/** The controller remains the sole persistence/transport authority. No optimistic messages. */
export function AssistantConversation({ messages, composer, children }: { messages: readonly CollaborationMessage[]; composer: CollaborationPanelProps['composer']; children: React.ReactNode }) {
  const visible = React.useMemo(() => messages.filter(message => message.kind !== 'activity' || message.important), [messages]);
  const runtime = useExternalStoreRuntime({ messages: visible, convertMessage: toAssistantMessage, isRunning: false, isSendDisabled: Boolean(composer.disabledReason || composer.sending || !composer.onSend), onNew: async message => { const text = message.content.filter(part => part.type === 'text').map(part => part.text).join('\n'); await composer.onSend?.(text); } });
  React.useEffect(() => { if (runtime.thread.composer.getState().text !== composer.text) runtime.thread.composer.setText(composer.text); }, [runtime, composer.text, composer.sending, composer.error]);
  return <AssistantRuntimeProvider runtime={runtime}><ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">{children}</ThreadPrimitive.Root></AssistantRuntimeProvider>;
}
