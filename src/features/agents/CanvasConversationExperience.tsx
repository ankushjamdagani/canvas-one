import * as React from "react";
import {
  Check,
  ChevronLeft,
  LocateFixed,
  MessageSquare,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import type { CollaborationTask } from "@canvas-one/agents";
import { ThreadPrimitive } from "@assistant-ui/react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { NativeSelect } from "../../components/ui/native-select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import {
  CanvasOneFace,
  type FaceExpression,
} from "../../components/ui/canvas-one-face";
import {
  AssistantConversation,
  AssistantMessage,
} from "./AssistantConversation";
import type { CanvasConversationThread } from "./canvas-conversations";
import type { CollaborationMessage } from "./CollaborationPanel";

export type ThreadStatus = {
  label: string;
  expression: FaceExpression;
  working: boolean;
  attention: boolean;
  complete: boolean;
};
export function conversationStatus(
  thread: CanvasConversationThread,
  tasks: readonly CollaborationTask[],
): ThreadStatus {
  const owned = tasks.filter((task) => thread.taskIds.includes(task.id));
  const running = [...owned]
    .reverse()
    .find((task) => ["requested", "working", "waiting"].includes(task.status));
  const latest = running ?? owned.at(-1);
  if (!running && !thread.resolved && thread.queuedRequests.length > 0) {
    const blocked = tasks.some(
      (task) =>
        task.kind !== "question" &&
        ["requested", "working", "waiting"].includes(task.status),
    );
    return {
      label: blocked ? "Waiting for earlier work" : "Waiting to send",
      expression: "wait",
      working: false,
      attention: !blocked,
      complete: false,
    };
  }
  const attention =
    latest?.status === "waiting" &&
    ["review", "clarification", "overlap"].includes(latest.waitReason ?? "");
  const waiting = latest?.status === "waiting";
  const working =
    latest?.status === "working" || latest?.status === "requested";
  return {
    label: thread.resolved
      ? "Resolved"
      : attention
        ? latest?.waitReason === "review"
          ? "Approval needed"
          : latest?.waitReason === "overlap"
            ? "Conflict needs a decision"
            : "Reply needed"
        : waiting
          ? latest?.waitReason === "feedbackDelivery"
            ? "Waiting for delivery"
            : "Waiting for earlier work"
          : working
            ? "Working"
            : latest?.status === "completed"
              ? "Completed"
              : latest?.status === "failed"
                ? "Failed · retry available"
                : latest?.status === "interrupted"
                  ? "Interrupted · resume available"
                  : latest?.status === "stopped"
                    ? "Stopped"
                    : "Conversation",
    expression:
      attention || waiting
        ? "wait"
        : working
          ? "squint"
          : latest?.status === "completed"
            ? "happy"
            : latest?.status === "failed"
              ? "error"
              : "base",
    working: Boolean(working && !thread.resolved),
    attention: Boolean(attention),
    complete: latest?.status === "completed",
  };
}

export function humanConversationMessages(
  thread: CanvasConversationThread,
): readonly CollaborationMessage[] {
  return thread.messages.map((message) => ({
    id: message.id,
    author: message.author.name,
    kind: message.author.kind === "human" ? "user" : "agent",
    text: message.text,
  }));
}

export function CommentsIndex({
  threads,
  tasks,
  error,
  onOpen,
  onCreate,
  targetLabel,
}: {
  threads: readonly CanvasConversationThread[];
  tasks: readonly CollaborationTask[];
  error?: string | null;
  onOpen: (id: string) => void;
  onCreate: (useSelection: boolean) => void;
  targetLabel: (thread: CanvasConversationThread) => string;
}) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const summaryFor = (thread: CanvasConversationThread) =>
    tasks.filter((task) => thread.taskIds.includes(task.id)).at(-1)
      ?.instruction ??
    thread.messages.at(-1)?.text ??
    conversationStatus(thread, tasks).label;
  const shown = threads.filter(
    (thread) =>
      (filter === "resolved"
        ? thread.resolved
        : !thread.resolved && (filter !== "unread" || thread.unread)) &&
      `${thread.title} ${targetLabel(thread)} ${summaryFor(thread)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  return (
    <section className="conversation-index" aria-label="Comments">
      <div className="conversation-index-tools">
        <div className="flex gap-2">
          <Button size="sm" onClick={() => onCreate(true)}>
            <Plus />
            New conversation
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onCreate(false)}>
            Board
          </Button>
        </div>
        <label className="conversation-search">
          <Search aria-hidden="true" className="size-4" />
          <Input
            aria-label="Search comments"
            placeholder="Search comments"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <NativeSelect
          aria-label="Filter comments"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All open</option>
          <option value="unread">Unread</option>
          <option value="resolved">Resolved</option>
        </NativeSelect>
      </div>
      {error && (
        <p role="alert" className="p-3 text-caption text-destructive">
          {error}
        </p>
      )}
      <div className="conversation-index-list">
        {shown.length === 0 ? (
          <p className="p-4 text-caption text-secondary-text">
            {query || filter !== "all"
              ? "No matching conversations."
              : "Discuss the board with people or invite AI. Conversations stay anchored on the canvas."}
          </p>
        ) : (
          shown
            .slice()
            .reverse()
            .map((thread) => {
              const status = conversationStatus(thread, tasks);
              return (
                <button
                  key={thread.id}
                  className="conversation-index-row"
                  onClick={() => onOpen(thread.id)}
                  aria-label={`Open ${thread.title}, ${status.label}${thread.unread ? ", unread" : ""}`}
                >
                  <span className="flex items-center gap-2">
                    <MessageSquare className="size-4 shrink-0" />
                    <strong className="truncate">{thread.title}</strong>
                    {thread.unread && (
                      <span
                        className="conversation-unread"
                        aria-label="Unread"
                      />
                    )}
                  </span>
                  <span className="text-secondary-text truncate">
                    {targetLabel(thread)}
                  </span>
                  <span className="text-secondary-text truncate">
                    {summaryFor(thread)}
                  </span>
                  <span className="text-caption">{status.label}</span>
                </button>
              );
            })
        )}
      </div>
    </section>
  );
}

export function ConversationPresence({
  threads,
  tasks,
  person,
  activeId,
  onOpen,
}: {
  threads: readonly CanvasConversationThread[];
  tasks: readonly CollaborationTask[];
  person: string;
  activeId?: string;
  onOpen: (id: string) => void;
}) {
  const ai = threads.filter((thread) => thread.aiEngaged && !thread.resolved);
  const foreground =
    ai.find((thread) => conversationStatus(thread, tasks).attention) ??
    ai.find((thread) => conversationStatus(thread, tasks).working) ??
    ai.at(-1);
  const identity = (thread: CanvasConversationThread) => {
    const request = tasks
      .filter((task) => thread.taskIds.includes(task.id))
      .at(-1);
    return `${thread.title} · ${request?.providerId ?? "AI"} · ${request?.instruction.slice(0, 80) ?? (thread.targetIds.length ? `${thread.targetIds.length} linked objects` : "Whole board")} · ${conversationStatus(thread, tasks).label}`;
  };
  const menuItems = (items: readonly CanvasConversationThread[]) =>
    items.map((thread) => (
      <DropdownMenuItem
        key={thread.id}
        onSelect={() => requestAnimationFrame(() => onOpen(thread.id))}
      >
        <CanvasOneFace
          size={24}
          expression={conversationStatus(thread, tasks).expression}
          animate={false}
          transition={false}
        />
        <span className="max-w-64 whitespace-normal break-words">
          {identity(thread)}
        </span>
      </DropdownMenuItem>
    ));
  return (
    <div
      className="conversation-presence"
      aria-label="Collaborators"
      data-testid="topbar-collaborators"
    >
      <div className="conversation-presence-mobile">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="pointer-coarse:min-w-11 pointer-coarse:min-h-11"
              aria-label={`Collaborators: ${person}, ${ai.length} AI conversations`}
            >
              {foreground ? (
                <CanvasOneFace
                  size={26}
                  expression={conversationStatus(foreground, tasks).expression}
                  animate={false}
                  transition={false}
                />
              ) : (
                <span className="text-caption">
                  {person.slice(0, 2).toUpperCase()}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              People · {person} (this device)
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              AI conversations · {ai.length}
            </DropdownMenuLabel>
            {menuItems(ai)}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="conversation-presence-desktop">
        <div className="conversation-presence-group" aria-label="People">
          <span className="conversation-presence-label">People</span>
          <span
            className="conversation-person"
            title={`${person} (this device)`}
            aria-label={`${person} (this device)`}
          >
            {person.slice(0, 2).toUpperCase()}
          </span>
        </div>
        {ai.length > 0 && (
          <div
            className="conversation-presence-group"
            aria-label="AI conversations"
          >
            <span className="conversation-presence-label">AI</span>
            {ai.slice(0, 3).map((thread) => {
              const status = conversationStatus(thread, tasks);
              return (
                <button
                  key={thread.id}
                  className="conversation-avatar"
                  style={threadIdentityStyle(thread.id)}
                  onClick={() => onOpen(thread.id)}
                  aria-label={identity(thread)}
                  title={identity(thread)}
                  data-attention={status.attention}
                  data-complete={status.complete}
                >
                  <CanvasOneFace
                    expression={status.expression}
                    size={28}
                    animate={false}
                    transition={false}
                  />
                  <span className="conversation-status-dot" />
                </button>
              );
            })}
            {ai.length > 3 && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${ai.length - 3} more AI conversations`}
                  >
                    +{ai.length - 3}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {menuItems(ai.slice(3))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function threadIdentityStyle(id: string): React.CSSProperties {
  const hues = [156, 216, 276, 24, 186];
  let hash = 0;
  for (const c of id) hash = (hash * 31 + c.charCodeAt(0)) | 0;
  return {
    "--conversation-hue": hues[Math.abs(hash) % hues.length],
  } as React.CSSProperties;
}

export function CanvasConversationLayer({
  threads,
  tasks,
  viewport,
  targets,
  activeId,
  onOpen,
  onClose,
  renderThread,
  preview,
}: {
  threads: readonly CanvasConversationThread[];
  tasks: readonly CollaborationTask[];
  viewport: { x: number; y: number; zoom: number };
  targets: readonly { id: string; x: number; y: number }[];
  activeId?: string;
  onOpen: (id: string) => void;
  onClose: () => void;
  renderThread: (thread: CanvasConversationThread) => React.ReactNode;
  preview?: React.ReactNode;
}) {
  const current = threads.find((thread) => thread.id === activeId);
  const expandedRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (activeId) expandedRef.current?.focus();
  }, [activeId]);
  const close = () => {
    onClose();
    requestAnimationFrame(() =>
      (
        document.querySelector<HTMLButtonElement>(
          `[data-conversation-pin="${CSS.escape(activeId ?? "")}"]`,
        ) ??
        document.querySelector<HTMLButtonElement>(
          '[data-testid="topbar-agents-btn"]',
        )
      )?.focus(),
    );
  };
  const foregroundWorkingId = !current
    ? threads.find((thread) => conversationStatus(thread, tasks).working)?.id
    : undefined;
  const foregroundAttentionId = !current
    ? threads.find((thread) => conversationStatus(thread, tasks).attention)?.id
    : undefined;
  const pointFor = (thread: CanvasConversationThread) =>
    thread.targetIds.length === 1
      ? (targets.find((target) => target.id === thread.targetIds[0]) ??
        thread.anchor)
      : thread.anchor;
  return (
    <div
      className="conversation-canvas-layer"
      data-testid="canvas-conversations"
    >
      {threads
        .filter((thread) => !thread.resolved || thread.id === activeId)
        .map((thread) => {
          const point = pointFor(thread),
            status = conversationStatus(thread, tasks);
          return (
            <button
              key={thread.id}
              data-conversation-pin={thread.id}
              style={{
                ...threadIdentityStyle(thread.id),
                left:
                  point.x * viewport.zoom +
                  viewport.x +
                  (thread.targetIds.length === 1 ? 24 : 0),
                top: point.y * viewport.zoom + viewport.y - 40,
              }}
              className="conversation-pin"
              data-testid="conversation-pin"
              data-active={thread.id === activeId}
              data-attention={thread.id === foregroundAttentionId}
              data-complete={status.complete && thread.unread}
              onClick={() => onOpen(thread.id)}
              aria-label={`${thread.title}, ${status.label}${thread.unread ? ", unread" : ""}`}
              title={`${thread.title} · ${status.label}`}
            >
              {thread.aiEngaged ? (
                <CanvasOneFace
                  size={28}
                  expression={status.expression}
                  animate={thread.id === foregroundWorkingId}
                  transition={false}
                />
              ) : (
                <MessageSquare className="size-4" />
              )}
              <span>
                {thread.messages.length +
                  tasks.filter((task) => thread.taskIds.includes(task.id))
                    .length}
              </span>
              {status.attention ? (
                <span aria-hidden="true">!</span>
              ) : status.complete && thread.unread ? (
                <Check className="size-3" />
              ) : thread.unread ? (
                <span className="conversation-unread" />
              ) : null}
            </button>
          );
        })}
      {preview}
      {current && (
        <section
          ref={expandedRef}
          tabIndex={-1}
          className="conversation-expanded"
          style={threadIdentityStyle(current.id)}
          aria-label={`Conversation: ${current.title}`}
          data-testid="canvas-conversation-expanded"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              close();
            }
          }}
        >
          <header className="conversation-expanded-header">
            <MessageSquare className="size-4" />
            <h2 className="truncate font-medium">{current.title}</h2>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Minimize conversation"
              onClick={close}
            >
              <Minus />
            </Button>
          </header>
          <p role="status" aria-live="polite" className="sr-only">
            {conversationStatus(current, tasks).label}
          </p>
          {renderThread(current)}
        </section>
      )}
    </div>
  );
}

export function HumanConversation({
  thread,
  draft,
  onDraftChange,
  onSend,
  onAskAI,
  error,
}: {
  thread: CanvasConversationThread;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: () => Promise<void>;
  onAskAI: () => void;
  error?: string;
}) {
  const [sending, setSending] = React.useState(false);
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <AssistantConversation
        messages={humanConversationMessages(thread)}
        composer={{
          intent: "question",
          text: "",
          context: [],
          onTextChange: () => {},
          onIntentChange: () => {},
        }}
      >
        <ThreadPrimitive.Viewport className="flex-1 overflow-auto p-3">
          <ul className="space-y-4">
            <ThreadPrimitive.Messages
              components={{ Message: AssistantMessage }}
            />
          </ul>
          {thread.messages.length === 0 && (
            <p className="text-caption text-secondary-text">
              Leave a comment, or invite AI to this conversation.
            </p>
          )}
        </ThreadPrimitive.Viewport>
      </AssistantConversation>
      <form
        className="conversation-human-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (sending) return;
          setSending(true);
          void onSend().finally(() => setSending(false));
        }}
      >
        <Textarea
          aria-label="Write a comment"
          placeholder="Write a comment… Markdown supported"
          value={draft}
          disabled={sending}
          onChange={(event) => onDraftChange(event.target.value)}
        />
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAskAI}
            disabled={sending}
          >
            <Plus />
            Ask AI
          </Button>
          <Button type="submit" size="sm" disabled={sending || !draft.trim()}>
            Comment
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-caption text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}

export function ConversationScope({
  thread,
  labels,
  selectionAvailable,
  busy,
  onUseSelection,
  onBoard,
  onLocate,
  onResolve,
  onBack,
}: {
  thread: CanvasConversationThread;
  labels: readonly { id: string; label: string; missing: boolean }[];
  selectionAvailable: boolean;
  busy: boolean;
  onUseSelection: () => void;
  onBoard: () => void;
  onLocate: () => void;
  onResolve: () => void;
  onBack: () => void;
}) {
  return (
    <div className="conversation-scope">
      <div className="flex flex-wrap items-center gap-1">
        <Button
          size="icon"
          variant="ghost"
          aria-label="Back to comments"
          onClick={onBack}
        >
          <ChevronLeft />
        </Button>
        <Button size="sm" variant="ghost" onClick={onLocate}>
          <LocateFixed />
          {thread.targetIds.length
            ? `${thread.targetIds.length} linked ${thread.targetIds.length === 1 ? "object" : "objects"}`
            : "Whole board"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onResolve}
          disabled={busy}
          title={
            busy
              ? "Stop active work before resolving this conversation"
              : undefined
          }
        >
          {thread.resolved ? "Reopen" : "Resolve"}
        </Button>
      </div>
      {labels.length > 0 && (
        <p className="text-caption text-secondary-text break-words">
          {labels
            .map(
              (item) =>
                `${item.label}${item.missing ? " (deleted · reattach)" : ""}`,
            )
            .join(", ")}
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onUseSelection}
          disabled={busy || !selectionAvailable}
        >
          {labels.some((item) => item.missing)
            ? "Reattach to selection"
            : "Use selection"}
        </Button>
        {thread.targetIds.length > 0 && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onBoard}>
            Use whole board
          </Button>
        )}
      </div>
    </div>
  );
}
