import { ComposedCanvas } from '../ComposedCanvas';

export default function CanvasPage() {
  return (
    <>
      <ComposedCanvas />
      <a href="/" className="host-link" data-testid="host-home-link">Host home</a>
    </>
  );
}
