import * as React from "react";
import { useStore } from "@xyflow/react";

/**
 * Snapped crosshair that follows a mouse over the canvas, from the Project
 * Canvas design. It snaps to the same dots ReactFlow's Background draws
 * (`gap` flow units apart, offset by the viewport) and labels the snapped
 * point in flow coordinates. Decorative: pointer-events are off, touch and
 * pen pointers are ignored, and reduced motion removes it entirely.
 */
export function CanvasCrosshair({ gap }: { gap: number }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const viewport = useStore((s) => s.transform);
  const view = React.useRef({ x: 0, y: 0, zoom: 1, gap });
  view.current = { x: viewport[0], y: viewport[1], zoom: viewport[2], gap };

  React.useEffect(() => {
    const canvas = ref.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const ratio = Math.min(devicePixelRatio || 1, 3);
    let width = 0;
    let height = 0;
    let pointer: { x: number; y: number } | null = null;
    let frame = 0;
    const smooth = { x: 0, y: 0, strength: 0 };
    const cross = { x: 0, y: 0, ready: false };

    const resize = () => {
      width = host.clientWidth;
      height = host.clientHeight;
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
    };
    const draw = () => {
      frame = 0;
      const reduced = media.matches;
      smooth.strength +=
        ((pointer && !reduced ? 1 : 0) - smooth.strength) * 0.12;
      if (pointer) {
        smooth.x += (pointer.x - smooth.x) * 0.2;
        smooth.y += (pointer.y - smooth.y) * 0.2;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      if (smooth.strength > 0.02) {
        const { x: vx, y: vy, zoom, gap: pitch } = view.current;
        const step = pitch * zoom;
        const tx = Math.round((smooth.x - vx) / step) * step + vx;
        const ty = Math.round((smooth.y - vy) / step) * step + vy;
        if (!cross.ready) {
          cross.x = tx;
          cross.y = ty;
          cross.ready = true;
        }
        cross.x += (tx - cross.x) * 0.3;
        cross.y += (ty - cross.y) * 0.3;
        const a = 0.5 * smooth.strength;
        const h = ctx.createLinearGradient(cross.x - 360, 0, cross.x + 360, 0);
        const v = ctx.createLinearGradient(0, cross.y - 260, 0, cross.y + 260);
        for (const g of [h, v]) {
          g.addColorStop(0, "rgba(11,92,84,0)");
          g.addColorStop(0.5, `rgba(11,92,84,${a})`);
          g.addColorStop(1, "rgba(11,92,84,0)");
        }
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = h;
        ctx.beginPath();
        ctx.moveTo(cross.x - 360, cross.y);
        ctx.lineTo(cross.x + 360, cross.y);
        ctx.stroke();
        ctx.strokeStyle = v;
        ctx.beginPath();
        ctx.moveTo(cross.x, cross.y - 260);
        ctx.lineTo(cross.x, cross.y + 260);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = `rgba(11,92,84,${1.3 * a})`;
        ctx.strokeRect(cross.x - 3.5, cross.y - 3.5, 7, 7);
        ctx.font = '9px "Martian Mono", monospace';
        ctx.fillStyle = `rgba(11,92,84,${1.2 * a})`;
        ctx.fillText(
          `${Math.round((tx - vx) / zoom)} · ${Math.round((ty - vy) / zoom)}`,
          cross.x + 9,
          cross.y - 8,
        );
      }
      // Keep drawing only while the crosshair is visible or still easing.
      if (pointer || smooth.strength > 0.02) schedule();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || media.matches) return;
      const rect = host.getBoundingClientRect();
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (smooth.strength < 0.02) {
        smooth.x = pointer.x;
        smooth.y = pointer.y;
        cross.ready = false;
      }
      schedule();
    };
    const leave = () => {
      pointer = null;
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", leave);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", leave);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-decoration="canvas-crosshair"
      className="pointer-events-none absolute inset-0 size-full"
      style={{ zIndex: 1 }}
    />
  );
}
