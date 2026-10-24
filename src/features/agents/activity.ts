/** Presentation evidence only; never grants execution or board-write authority. */
export type AgentActivity = {
  readonly id: string;
  readonly taskId: string;
  readonly attemptId: string;
  readonly generation: number;
  readonly kind: 'reading' | 'applying' | 'reviewing';
  readonly targetIds: readonly string[];
  readonly label: string;
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly startedAt: number;
  readonly completedAt?: number;
};
