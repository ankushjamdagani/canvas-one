import { isBridgeRequest, loopbackBridgeUrl, type BridgeParticipant, type BridgeReply, type BridgeRequest } from './index.js';
export type BridgeConnection = { readonly participant: BridgeParticipant; dispose(): void };
/** Tokens live only in this connection closure, never authored data or browser persistence. */
export async function pairBrowserBridge(options: {
  readonly url: string; readonly code: string;
  readonly handle: (request: BridgeRequest, participant: BridgeParticipant) => unknown | Promise<unknown>;
  readonly onStatus?: (status: 'connected' | 'reconnecting' | 'disconnected') => void;
}): Promise<BridgeConnection> {
  const url = loopbackBridgeUrl(options.url);
  const response = await fetch(url + '/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code: options.code})});
  if (!response.ok) throw new Error('Pairing failed. Check the code, its expiry and the bridge allowed origin.');
  const pairing = await response.json() as {token: string; participant: BridgeParticipant};
  if (typeof pairing.token !== 'string' || !pairing.participant || pairing.participant.kind !== 'agent') throw new Error('Invalid pairing response');
  const abort = new AbortController();
  let disposed = false;
  const replies = new Map<string, BridgeReply>();
  const headers = {Authorization: 'Bearer ' + pairing.token, 'Content-Type': 'application/json'};
  const delay = () => new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); abort.signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 750);
    abort.signal.addEventListener('abort', finish, {once: true});
    if (abort.signal.aborted) finish();
  });
  const poll = async (): Promise<void> => {
    while (!disposed) {
      try {
        const pending = await fetch(url + '/browser/requests', {headers, signal: abort.signal});
        if (!pending.ok) { if ([401, 403, 410].includes(pending.status)) { dispose(); break; } throw new Error('Bridge unavailable'); }
        const requests: unknown = await pending.json();
        if (!Array.isArray(requests)) throw new Error('Invalid bridge response');
        options.onStatus?.('connected');
        for (const request of requests) {
          if (disposed) break;
          if (!isBridgeRequest(request)) continue;
          let reply = replies.get(request.requestId);
          if (!reply) {
            try { reply = {requestId: request.requestId, result: await options.handle(request, pairing.participant)}; }
            catch { reply = {requestId: request.requestId, error: 'Browser tool failed'}; }
            replies.set(request.requestId, reply);
            if (replies.size > 1000) replies.delete(replies.keys().next().value!);
          }
          const posted = await fetch(url + '/browser/result', {method: 'POST', headers, body: JSON.stringify(reply), signal: abort.signal});
          if (!posted.ok) throw new Error('Bridge result was not acknowledged');
        }
      } catch { if (!disposed) options.onStatus?.('reconnecting'); }
      if (!disposed) await delay();
    }
  };
  function dispose(): void {
    if (disposed) return;
    disposed = true; abort.abort(); replies.clear();
    void fetch(url + '/browser/disconnect', {method: 'POST', headers}).catch(() => undefined);
    options.onStatus?.('disconnected');
  }
  void poll();
  return {participant: pairing.participant, dispose};
}
