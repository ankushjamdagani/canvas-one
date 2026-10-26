/** Conversation annotations are collaboration metadata, never authored diagram records. */
export type CanvasConversationScope = {
  readonly projectId: string;
  readonly boardId: string;
  readonly branchId?: string;
};
export type CanvasConversationAuthor = {
  readonly id: string;
  readonly name: string;
  readonly kind: "human" | "ai";
};
export type CanvasConversationMessage = {
  readonly id: string;
  readonly text: string;
  readonly author: CanvasConversationAuthor;
  readonly createdAt: number;
};
export type CanvasConversationAnchor = {
  readonly x: number;
  readonly y: number;
};
/** Waiting requests require an explicit Send action; storage never launches them. */
export type CanvasConversationQueuedRequest = {
  readonly id: string;
  readonly text: string;
  readonly providerId: string;
  readonly permissionMode: "read" | "write";
  readonly writeBehavior: "suggest" | "live";
  readonly targetIds?: readonly string[];
  /** Captured execution branch; board annotations themselves can span drafts. */
  readonly branchId?: string;
  readonly createdAt: number;
};
export type EnqueueCanvasConversationRequest = Omit<
  CanvasConversationQueuedRequest,
  "id" | "createdAt"
>;
export type CanvasConversationThread = {
  readonly id: string;
  readonly title: string;
  /** Empty means the whole board. Membership is explicit and never follows selection. */
  readonly targetIds: readonly string[];
  /** Last known labels survive target deletion; IDs remain the authority. */
  readonly targetNames?: Readonly<Record<string, string>>;
  readonly anchor: CanvasConversationAnchor;
  readonly messages: readonly CanvasConversationMessage[];
  readonly taskIds: readonly string[];
  readonly participants: readonly CanvasConversationAuthor[];
  readonly queuedRequests: readonly CanvasConversationQueuedRequest[];
  readonly resolved: boolean;
  readonly unread: boolean;
  readonly aiEngaged: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};
export type CanvasConversationSnapshot = {
  readonly threads: readonly CanvasConversationThread[];
  readonly loaded: boolean;
  readonly error: string | null;
};
export type CreateCanvasConversation = {
  readonly title?: string;
  readonly targetIds?: readonly string[];
  readonly targetNames?: Readonly<Record<string, string>>;
  readonly anchor: CanvasConversationAnchor;
  readonly author?: CanvasConversationAuthor;
};
type StoredBoard = {
  readonly key: string;
  readonly version: 1;
  readonly threads: readonly CanvasConversationThread[];
};
export type CanvasConversationStoreOptions = {
  readonly databaseName?: string;
  readonly indexedDB?: IDBFactory;
  readonly mintId?: () => string;
  readonly now?: () => number;
  readonly broadcast?: boolean;
};

const DATABASE = "canvas-one-conversation-annotations-v1";
const TABLE = "boards";
const LOCAL_AUTHOR: CanvasConversationAuthor = {
  id: "local-human",
  name: "You",
  kind: "human",
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const authorValid = (value: unknown): value is CanvasConversationAuthor =>
  record(value) &&
  string(value.id) &&
  string(value.name) &&
  (value.kind === "human" || value.kind === "ai");
const anchorValid = (value: unknown): value is CanvasConversationAnchor =>
  record(value) && finite(value.x) && finite(value.y);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(string);
const targetNamesValid = (value: unknown): value is Record<string, string> =>
  record(value) &&
  Object.keys(value).length <= 1000 &&
  Object.entries(value).every(
    ([key, label]) =>
      key.length > 0 &&
      key.length <= 200 &&
      typeof label === "string" &&
      label.length <= 500,
  );
const selectedTargetNames = (
  ids: readonly string[],
  names: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    ids.flatMap((id) =>
      Object.prototype.hasOwnProperty.call(names, id) ? [[id, names[id]!]] : [],
    ),
  );

function readBoard(raw: unknown, key: string): StoredBoard {
  if (raw === undefined) return { key, version: 1, threads: [] };
  if (
    !record(raw) ||
    raw.key !== key ||
    raw.version !== 1 ||
    !Array.isArray(raw.threads)
  )
    throw new Error(
      "Stored comments could not be read. Existing data has been preserved.",
    );
  const seen = new Set<string>();
  for (const thread of raw.threads) {
    if (
      !record(thread) ||
      !string(thread.id) ||
      seen.has(thread.id) ||
      !string(thread.title) ||
      !strings(thread.targetIds) ||
      (thread.targetNames !== undefined &&
        !targetNamesValid(thread.targetNames)) ||
      !anchorValid(thread.anchor) ||
      !Array.isArray(thread.messages) ||
      !strings(thread.taskIds) ||
      !Array.isArray(thread.participants) ||
      !thread.participants.every(authorValid) ||
      typeof thread.resolved !== "boolean" ||
      typeof thread.unread !== "boolean" ||
      typeof thread.aiEngaged !== "boolean" ||
      !finite(thread.createdAt) ||
      !finite(thread.updatedAt)
    )
      throw new Error(
        "Stored comments could not be read. Existing data has been preserved.",
      );
    seen.add(thread.id);
    const messages = new Set<string>();
    for (const message of thread.messages) {
      if (
        !record(message) ||
        !string(message.id) ||
        messages.has(message.id) ||
        typeof message.text !== "string" ||
        !authorValid(message.author) ||
        !finite(message.createdAt)
      )
        throw new Error(
          "Stored comment messages could not be read. Existing data has been preserved.",
        );
      messages.add(message.id);
    }
    if (thread.queuedRequests !== undefined) {
      if (!Array.isArray(thread.queuedRequests))
        throw new Error(
          "Stored waiting requests could not be read. Existing data has been preserved.",
        );
      const requests = new Set<string>();
      for (const request of thread.queuedRequests) {
        if (
          !record(request) ||
          !string(request.id) ||
          requests.has(request.id) ||
          !string(request.text) ||
          request.text.length > 100_000 ||
          !string(request.providerId) ||
          !["read", "write"].includes(String(request.permissionMode)) ||
          !["suggest", "live"].includes(String(request.writeBehavior)) ||
          (request.targetIds !== undefined && !strings(request.targetIds)) ||
          (request.branchId !== undefined && !string(request.branchId)) ||
          !finite(request.createdAt)
        )
          throw new Error(
            "Stored waiting requests could not be read. Existing data has been preserved.",
          );
        requests.add(request.id);
      }
    }
  }
  // Metadata created before the queue remains readable without a DB upgrade.
  return {
    ...(raw as unknown as StoredBoard),
    threads: (raw.threads as unknown as CanvasConversationThread[]).map(
      (thread) => ({
        ...thread,
        queuedRequests: thread.queuedRequests ?? [],
        targetNames: thread.targetNames ?? {},
      }),
    ),
  };
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * A board-scoped external store. Every write rereads metadata in the same IDB
 * transaction, so separate tabs cannot replace each other's threads/messages.
 * AI execution and permission remain exclusively in AgentConversationController.
 */
export class CanvasConversationStore {
  readonly ready: Promise<void>;
  private state: CanvasConversationSnapshot = immutable({
    threads: [],
    loaded: false,
    error: null,
  });
  private readonly listeners = new Set<() => void>();
  private readonly key: string;
  private readonly database: Promise<IDBDatabase>;
  private readonly mintId: () => string;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private channel: BroadcastChannel | null = null;
  private disposed = false;

  constructor(
    readonly scope: CanvasConversationScope,
    options: CanvasConversationStoreOptions = {},
  ) {
    if (
      !string(scope.projectId) ||
      !string(scope.boardId) ||
      (scope.branchId !== undefined && !string(scope.branchId))
    )
      throw new Error("A project and board are required for comments");
    this.key = JSON.stringify([
      scope.projectId,
      scope.branchId ?? "",
      scope.boardId,
    ]);
    this.mintId = options.mintId ?? (() => crypto.randomUUID());
    this.now = options.now ?? Date.now;
    const databaseName = options.databaseName ?? DATABASE;
    const factory = options.indexedDB ?? globalThis.indexedDB;
    this.database = new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error("Comment storage is unavailable in this browser"));
        return;
      }
      const request = factory.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(TABLE))
          request.result.createObjectStore(TABLE, { keyPath: "key" });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(
          request.error ?? new Error("Comment storage could not be opened"),
        );
      request.onblocked = () =>
        reject(
          new Error("Close another Canvas One tab to open comment storage"),
        );
    });
    this.ready = this.load().catch((error) => {
      this.problem(error);
    });
    if (
      options.broadcast !== false &&
      typeof BroadcastChannel !== "undefined"
    ) {
      this.channel = new BroadcastChannel(`${databaseName}:updates`);
      this.channel.onmessage = (event) => {
        if (event.data === this.key) void this.refresh();
      };
    }
  }

  getState = (): CanvasConversationSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<CanvasConversationSnapshot>): void {
    if (this.disposed) return;
    this.state = immutable({ ...this.state, ...patch });
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* View errors cannot change persistence. */
      }
    }
  }
  private problem(error: unknown): void {
    this.publish({
      error:
        error instanceof Error ? error.message : "Comments could not be saved",
    });
  }
  private async load(): Promise<void> {
    const db = await this.database;
    const board = await new Promise<StoredBoard>((resolve, reject) => {
      const transaction = db.transaction(TABLE, "readonly");
      const request = transaction.objectStore(TABLE).get(this.key);
      request.onsuccess = () => {
        try {
          resolve(readBoard(request.result, this.key));
        } catch (error) {
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Comments could not be loaded"));
    });
    this.publish({ threads: board.threads, loaded: true, error: null });
  }
  refresh = (): Promise<void> => {
    const pending = this.queue
      .then(() => this.load())
      .catch((error) => {
        this.problem(error);
      });
    this.queue = pending;
    return pending;
  };

  private mutate<T>(
    change: (threads: readonly CanvasConversationThread[]) => {
      threads: readonly CanvasConversationThread[];
      result: T;
    },
  ): Promise<T> {
    const pending = this.queue.then(async () => {
      await this.ready;
      if (this.disposed) throw new Error("This comment board has closed");
      const db = await this.database;
      const committed = await new Promise<{ board: StoredBoard; result: T }>(
        (resolve, reject) => {
          const transaction = db.transaction(TABLE, "readwrite");
          const store = transaction.objectStore(TABLE);
          const request = store.get(this.key);
          let result: { board: StoredBoard; result: T } | undefined;
          let failure: unknown;
          request.onsuccess = () => {
            try {
              const board = readBoard(request.result, this.key);
              const changed = change(board.threads);
              result = {
                board: { ...board, threads: changed.threads },
                result: changed.result,
              };
              store.put(result.board);
            } catch (error) {
              failure = error;
              transaction.abort();
            }
          };
          transaction.oncomplete = () =>
            result
              ? resolve(result)
              : reject(new Error("Comments were not saved"));
          transaction.onerror = () => {
            /* onabort reports the final failed transaction. */
          };
          transaction.onabort = () =>
            reject(
              failure ??
                transaction.error ??
                new Error("Comments could not be saved"),
            );
        },
      );
      this.publish({
        threads: committed.board.threads,
        loaded: true,
        error: null,
      });
      this.channel?.postMessage(this.key);
      return committed.result;
    });
    this.queue = pending.then(
      () => undefined,
      (error) => {
        this.problem(error);
      },
    );
    return pending;
  }

  create(input: CreateCanvasConversation): Promise<CanvasConversationThread> {
    if (!anchorValid(input.anchor))
      return Promise.reject(new Error("Choose a valid canvas position"));
    const author = input.author ?? LOCAL_AUTHOR;
    if (!authorValid(author))
      return Promise.reject(new Error("A comment contributor is required"));
    const targetIds = [...new Set(input.targetIds ?? [])];
    if (!strings(targetIds))
      return Promise.reject(
        new Error("Comment targets must be explicit object IDs"),
      );
    if (input.targetNames !== undefined && !targetNamesValid(input.targetNames))
      return Promise.reject(
        new Error("Comment target names must be text of up to 500 characters"),
      );
    return this.mutate((threads) => {
      const now = this.now();
      const thread: CanvasConversationThread = {
        id: this.mintId(),
        title: input.title?.trim().slice(0, 160) || "New conversation",
        targetIds,
        targetNames: selectedTargetNames(targetIds, input.targetNames),
        anchor: { ...input.anchor },
        messages: [],
        taskIds: [],
        participants: [{ ...author }],
        queuedRequests: [],
        resolved: false,
        unread: false,
        aiEngaged: false,
        createdAt: now,
        updatedAt: now,
      };
      if (threads.some((existing) => existing.id === thread.id))
        throw new Error("A conversation with this ID already exists");
      return { threads: [...threads, thread], result: thread };
    });
  }

  private update(
    id: string,
    change: (thread: CanvasConversationThread) => CanvasConversationThread,
  ): Promise<CanvasConversationThread> {
    return this.mutate((threads) => {
      const current = threads.find((thread) => thread.id === id);
      if (!current) throw new Error("This conversation could not be found");
      const next = { ...change(current), updatedAt: this.now() };
      return {
        threads: threads.map((thread) => (thread.id === id ? next : thread)),
        result: next,
      };
    });
  }

  appendMessage(
    id: string,
    input: {
      readonly text: string;
      readonly author?: CanvasConversationAuthor;
    },
  ): Promise<CanvasConversationThread> {
    const author = input.author ?? LOCAL_AUTHOR;
    const text = input.text.trim();
    if (!text || text.length > 100_000 || !authorValid(author))
      return Promise.reject(
        new Error("Enter a comment of up to 100,000 characters"),
      );
    return this.update(id, (thread) => {
      const message: CanvasConversationMessage = {
        id: this.mintId(),
        text,
        author: { ...author },
        createdAt: this.now(),
      };
      if (thread.messages.some((existing) => existing.id === message.id))
        throw new Error("A message with this ID already exists");
      return {
        ...thread,
        title:
          thread.messages.length === 0 && thread.title === "New conversation"
            ? text.replace(/\s+/g, " ").slice(0, 80)
            : thread.title,
        messages: [...thread.messages, message],
        participants: thread.participants.some(
          (participant) => participant.id === author.id,
        )
          ? thread.participants
          : [...thread.participants, { ...author }],
        unread: author.kind === "ai",
        resolved: false,
      };
    });
  }

  attachTask(id: string, taskId: string): Promise<CanvasConversationThread> {
    if (!string(taskId))
      return Promise.reject(new Error("A durable AI request ID is required"));
    return this.update(id, (thread) => ({
      ...thread,
      resolved: false,
      aiEngaged: true,
      taskIds: [...new Set([...thread.taskIds, taskId])],
    }));
  }
  /**
   * Call from the controller's durable onCreated hook before execution launches.
   * A consumed queue item cannot be launched again after a crash between launch
   * and a separate acknowledgement. Failure recovery belongs to the linked task.
   */
  attachQueuedTask(
    id: string,
    requestId: string,
    taskId: string,
  ): Promise<CanvasConversationThread> {
    if (!string(taskId))
      return Promise.reject(new Error("A durable AI request ID is required"));
    return this.update(id, (thread) => {
      if (!thread.queuedRequests.some((request) => request.id === requestId))
        throw new Error(
          "This waiting request has already been sent or canceled",
        );
      return {
        ...thread,
        resolved: false,
        aiEngaged: true,
        taskIds: [...new Set([...thread.taskIds, taskId])],
        queuedRequests: thread.queuedRequests.filter(
          (request) => request.id !== requestId,
        ),
      };
    });
  }
  enqueueRequest(
    id: string,
    input: EnqueueCanvasConversationRequest,
  ): Promise<string> {
    const text = input.text.trim();
    if (
      !text ||
      text.length > 64_000 ||
      !string(input.providerId) ||
      !["read", "write"].includes(input.permissionMode) ||
      !["suggest", "live"].includes(input.writeBehavior) ||
      (input.targetIds !== undefined && !strings(input.targetIds)) ||
      (input.branchId !== undefined && !string(input.branchId))
    )
      return Promise.reject(
        new Error(
          "Enter a valid waiting request of up to 64,000 characters and permission",
        ),
      );
    return this.mutate((threads) => {
      const current = threads.find((thread) => thread.id === id);
      if (!current) throw new Error("This conversation could not be found");
      if (current.queuedRequests.length >= 100)
        throw new Error("Send or remove a waiting request before adding more");
      const request: CanvasConversationQueuedRequest = {
        id: this.mintId(),
        text,
        providerId: input.providerId,
        permissionMode: input.permissionMode,
        writeBehavior: input.writeBehavior,
        ...(input.targetIds !== undefined
          ? { targetIds: [...new Set(input.targetIds)] }
          : {}),
        ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
        createdAt: this.now(),
      };
      if (current.queuedRequests.some((existing) => existing.id === request.id))
        throw new Error("A waiting request with this ID already exists");
      const next: CanvasConversationThread = {
        ...current,
        resolved: false,
        queuedRequests: [...current.queuedRequests, request],
        updatedAt: this.now(),
      };
      return {
        threads: threads.map((thread) => (thread.id === id ? next : thread)),
        result: request.id,
      };
    });
  }
  /** Explicit dismissal/acknowledgement only. This does not stop any AI task. */
  removeQueuedRequest(
    id: string,
    requestId: string,
  ): Promise<CanvasConversationThread> {
    return this.update(id, (thread) => ({
      ...thread,
      queuedRequests: thread.queuedRequests.filter(
        (request) => request.id !== requestId,
      ),
    }));
  }
  setAiEngaged(
    id: string,
    aiEngaged: boolean,
  ): Promise<CanvasConversationThread> {
    return this.update(id, (thread) => ({ ...thread, aiEngaged }));
  }
  setTitle(id: string, title: string): Promise<CanvasConversationThread> {
    const clean = title.trim().slice(0, 160);
    if (!clean) return Promise.reject(new Error("Enter a conversation title"));
    return this.update(id, (thread) => ({ ...thread, title: clean }));
  }
  setResolved(
    id: string,
    resolved: boolean,
  ): Promise<CanvasConversationThread> {
    return this.update(id, (thread) => ({ ...thread, resolved }));
  }
  markRead(id: string): Promise<CanvasConversationThread> {
    return this.update(id, (thread) => ({ ...thread, unread: false }));
  }
  markUnread(id: string): Promise<CanvasConversationThread> {
    return this.update(id, (thread) => ({ ...thread, unread: true }));
  }
  moveAnchor(
    id: string,
    anchor: CanvasConversationAnchor,
  ): Promise<CanvasConversationThread> {
    if (!anchorValid(anchor))
      return Promise.reject(new Error("Choose a valid canvas position"));
    return this.update(id, (thread) => ({ ...thread, anchor: { ...anchor } }));
  }
  setScope(
    id: string,
    targetIds: readonly string[],
    names?: Readonly<Record<string, string>>,
  ): Promise<CanvasConversationThread> {
    if (!strings(targetIds))
      return Promise.reject(
        new Error("Comment targets must be explicit object IDs"),
      );
    if (names !== undefined && !targetNamesValid(names))
      return Promise.reject(
        new Error("Comment target names must be text of up to 500 characters"),
      );
    return this.update(id, (thread) => ({
      ...thread,
      targetIds: [...new Set(targetIds)],
      targetNames: selectedTargetNames(targetIds, names ?? thread.targetNames),
    }));
  }
  dispose(): void {
    this.disposed = true;
    this.channel?.close();
    this.channel = null;
    this.listeners.clear();
    void this.database.then(
      (db) => db.close(),
      () => undefined,
    );
  }
}
