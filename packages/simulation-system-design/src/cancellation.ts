/** Native AbortSignal satisfies this headless cancellation contract. */
export interface CancellationSignal { readonly aborted: boolean; readonly reason?: unknown }
