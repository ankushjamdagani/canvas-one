import { CanvasOne } from '@canvas-one/react';

export default function CanvasPage() {
  return (
    <>
      <CanvasOne basePath="/canvas" storageNamespace="next-host-example" />
      <a href="/" className="host-link" data-testid="host-home-link">Host home</a>
    </>
  );
}
