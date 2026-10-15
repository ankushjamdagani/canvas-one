import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { CONNECTION_DETAILS_LIMIT, localServiceCommand, parseConnectionDetails } from './connection-setup';
import { conversationErrorMessage } from './conversation-errors';

export function ConnectionSetup({ connecting, error, onConnect }: { readonly connecting: boolean; readonly error?: string; readonly onConnect: (url: string, secret: string) => Promise<void> }) {
  const id = React.useId();
  const [details, setDetails] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [secret, setSecret] = React.useState('');
  const [manual, setManual] = React.useState(false);
  const [localError, setLocalError] = React.useState<string>();
  const [submitting, setSubmitting] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [command, setCommand] = React.useState('');
  React.useEffect(() => { setCommand(localServiceCommand(window.location.origin)); }, []);
  const busy = connecting || submitting;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setLocalError(undefined);
    try {
      const parsed = parseConnectionDetails(manual ? JSON.stringify({ url: url.trim(), pairingSecret: secret.trim() }) : details);
      setSubmitting(true);
      await onConnect(parsed.url, parsed.pairingSecret);
      setDetails(''); setSecret('');
    } catch (reason) { setLocalError(conversationErrorMessage(reason)); }
    finally { setSubmitting(false); }
  };
  const shownError = localError ?? error;
  const copyCommand = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(command); setCopied(true);
    } catch { setLocalError('Could not copy. Select and copy the command above.'); }
  };
  return <section aria-label="Connection setup" className="space-y-5 text-caption">
    <div><h3 className="font-medium text-foreground">Connect your local agents</h3><p className="mt-1 text-secondary-text">Use your installed CLIs and existing sign-in.</p></div>
    <div className="space-y-2"><p className="font-medium">1. Start the local service</p><p className="text-secondary-text">Run this from the Canvas One repository.</p><div className="flex items-start gap-1 border border-hairline rounded-md bg-background p-2"><code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-caption">{command || 'Preparing command…'}</code><Button type="button" variant="ghost" size="sm" disabled={!command} onClick={() => { void copyCommand(); }}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? 'Copied' : 'Copy'}</Button></div></div>
    <form onSubmit={event => { void submit(event); }} className="space-y-3">
      <div className="space-y-2"><Label htmlFor={`${id}-details`}>2. Paste connection details</Label><Input id={`${id}-details`} type="password" autoComplete="off" spellCheck={false} maxLength={CONNECTION_DETAILS_LIMIT} value={details} disabled={manual || busy} onChange={event => { setDetails(event.target.value); setLocalError(undefined); }} placeholder="Paste the JSON printed in your terminal" /><p className="text-secondary-text">Includes the service address and one-use pairing secret.</p></div>
      <details open={manual} onToggle={event => { const open = event.currentTarget.open; setManual(open); setLocalError(undefined); }}><summary className="cursor-pointer text-secondary-text">Advanced: enter details manually</summary><div className="mt-3 space-y-2"><Label htmlFor={`${id}-url`}>Service address</Label><Input id={`${id}-url`} type="url" value={url} maxLength={2048} autoComplete="off" spellCheck={false} placeholder="http://127.0.0.1:port" disabled={busy} onChange={event => setUrl(event.target.value)} /><Label htmlFor={`${id}-secret`}>Pairing secret</Label><Input id={`${id}-secret`} type="password" autoComplete="off" maxLength={64} value={secret} disabled={busy} onChange={event => setSecret(event.target.value)} /></div></details>
      {shownError && <p role="alert" className="text-destructive">{shownError === 'Local collaboration service is unavailable' ? 'Cannot reach the service. Keep its terminal running and check that the command uses this page’s origin.' : shownError}</p>}
      <div className="flex justify-end"><Button type="submit" size="sm" loading={busy} disabled={busy || (manual ? !url.trim() || !secret.trim() : !details.trim())}>{busy ? 'Connecting…' : 'Connect'}</Button></div>
    </form>
  </section>;
}
