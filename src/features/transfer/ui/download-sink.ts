/**
 * Browser download sink for transfer UI actions (RV-10b).
 *
 * Implements specs/revamp/contracts/parts-and-export.md ("JSON, images and files"):
 * "Revoke object URLs." The Blob -> object URL -> anchor click -> revoke sequence is the
 * only DOM/global side effect anywhere in the transfer UI module; it is injected into
 * `useTransferActions` so every action's own logic stays a pure, synchronously testable
 * function that never touches `document`/`URL` itself.
 */

/** A download sink takes a completed export Blob and its filename and delivers it. */
export type DownloadSink = (blob: Blob, fileName: string) => void;

/**
 * Default browser implementation: creates a Blob object URL, clicks a detached anchor
 * with the `download` attribute set to the export's filename, then always revokes the
 * URL (success or failure) so no export leaks a `blob:` URL into the document.
 */
export function createBrowserDownloadSink(): DownloadSink {
  return (blob: Blob, fileName: string) => {
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } finally {
      URL.revokeObjectURL(url);
    }
  };
}
