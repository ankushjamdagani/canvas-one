import * as React from "react";
import "./drafting-board.css";

export function DraftingFrame() {
  return <div className="drafting-frame" aria-hidden="true" />;
}

/** Full-viewport drafting surface; place a `DraftingStage` inside for fixed-coordinate content. */
export function DraftingBoard({
  children,
  paused = false,
}: {
  children: React.ReactNode;
  paused?: boolean;
}) {
  const [size, setSize] = React.useState({ w: innerWidth, h: innerHeight });
  React.useEffect(() => {
    const resize = () => setSize({ w: innerWidth, h: innerHeight });
    addEventListener("resize", resize);
    return () => removeEventListener("resize", resize);
  }, []);
  const scale = Math.min(1, size.w / 1440, size.h / 900);
  return (
    <div
      className="drafting-board"
      style={{ "--board-scale": scale } as React.CSSProperties}
    >
      <DraftingGround paused={paused} />
      <DraftingFrame />
      {children}
    </div>
  );
}

/** 1440×900 authored coordinate space, scaled to fit and centred on the board. */
export function DraftingStage({ children }: { children: React.ReactNode }) {
  return <div className="drafting-stage">{children}</div>;
}

export function DraftingGround({ paused = false }: { paused?: boolean }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const running = React.useRef(!paused);
  running.current = !paused;
  React.useEffect(() => {
    const canvas = ref.current!,
      board = canvas.parentElement!,
      ctx = canvas.getContext("2d");
    if (!ctx) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let reduced = media.matches;
    const ratio = Math.min(devicePixelRatio || 1, 3);
    let width = board.clientWidth,
      height = board.clientHeight;
    const resize = () => {
      width = board.clientWidth;
      height = board.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
    };
    resize();
    let pointer: { x: number; y: number } | null = null,
      frame = 0,
      previous = performance.now(),
      elapsed = 0;
    const trails: { x: number; y: number; t: number; alpha: number }[] = [];
    const makePacket = () => {
      const x =
          12 + 72 * Math.floor(1 + Math.random() * Math.max(1, width / 72 - 2)),
        y =
          12 +
          72 * Math.floor(1 + Math.random() * Math.max(1, height / 72 - 2));
      return {
        x,
        y,
        dx: 1,
        dy: 0,
        targetX: x + 72,
        targetY: y,
        history: [{ x, y }],
        age: -Math.random() * 3,
        life: 7 + Math.random() * 5,
        lastDot: "",
      };
    };
    const packets = Array.from({ length: 6 }, makePacket);
    const smooth = { x: 720, y: 450, strength: 0 };
    const cross = { x: 732, y: 444 };
    const move = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = {
        x: ((event.clientX - rect.left) * width) / rect.width,
        y: ((event.clientY - rect.top) * height) / rect.height,
      };
    };
    const leave = () => {
      pointer = null;
    };
    board.addEventListener("pointermove", move);
    board.addEventListener("pointerleave", leave);
    const draw = (now: number) => {
      const dt =
        running.current && !reduced ? Math.min(50, now - previous) / 1000 : 0;
      previous = now;
      elapsed += dt;
      smooth.strength +=
        ((pointer && !reduced ? 1 : 0) - smooth.strength) * 0.07;
      if (pointer) {
        smooth.x += (pointer.x - smooth.x) * 0.16;
        smooth.y += (pointer.y - smooth.y) * 0.16;
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.beginPath();
      ctx.rect(23, 23, Math.max(0, width - 46), Math.max(0, height - 46));
      ctx.clip();
      ctx.fillStyle =
        getComputedStyle(board).getPropertyValue("--grid").trim() || "#D3CDC1";
      ctx.beginPath();
      for (let x = 12; x < width; x += 24)
        for (let y = 12; y < height; y += 24) {
          ctx.moveTo(x + 1.25, y);
          ctx.arc(x, y, 1.25, 0, Math.PI * 2);
        }
      ctx.fill();
      if (!reduced && smooth.strength > 0.02) {
        const tx = Math.round((smooth.x - 12) / 24) * 24 + 12,
          ty = Math.round((smooth.y - 12) / 24) * 24 + 12;
        cross.x += (tx - cross.x) * 0.25;
        cross.y += (ty - cross.y) * 0.25;
        const a = 0.5 * smooth.strength;
        const horizontal = ctx.createLinearGradient(
            cross.x - 360,
            0,
            cross.x + 360,
            0,
          ),
          vertical = ctx.createLinearGradient(
            0,
            cross.y - 260,
            0,
            cross.y + 260,
          );
        for (const gradient of [horizontal, vertical]) {
          gradient.addColorStop(0, "rgba(11,92,84,0)");
          gradient.addColorStop(0.5, `rgba(11,92,84,${a})`);
          gradient.addColorStop(1, "rgba(11,92,84,0)");
        }
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = horizontal;
        ctx.beginPath();
        ctx.moveTo(cross.x - 360, cross.y);
        ctx.lineTo(cross.x + 360, cross.y);
        ctx.stroke();
        ctx.strokeStyle = vertical;
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
          `${Math.round(tx * 10)} · ${Math.round(ty * 10)}`,
          cross.x + 9,
          cross.y - 8,
        );
      }
      if (!reduced)
        for (const packet of packets) {
          packet.age += dt;
          if (packet.age >= packet.life) {
            packet.age = -Math.random() * 3;
            packet.life = 7 + Math.random() * 5;
            packet.history = [{ x: packet.x, y: packet.y }];
          }
          if (packet.age < 0) continue;
          let step = 64 * dt;
          while (step > 0) {
            const distance =
              Math.abs(packet.targetX - packet.x) +
              Math.abs(packet.targetY - packet.y);
            if (distance > step) {
              packet.x += packet.dx * step;
              packet.y += packet.dy * step;
              step = 0;
            } else {
              packet.x = packet.targetX;
              packet.y = packet.targetY;
              step -= distance;
              const chance = Math.random();
              if (chance < 0.22) {
                const dx = -packet.dy;
                packet.dy = packet.dx;
                packet.dx = dx;
              } else if (chance < 0.44) {
                const dx = packet.dy;
                packet.dy = -packet.dx;
                packet.dx = dx;
              }
              if (
                packet.x + packet.dx * 72 < 23 ||
                packet.x + packet.dx * 72 > width - 23 ||
                packet.y + packet.dy * 72 < 23 ||
                packet.y + packet.dy * 72 > height - 23
              ) {
                packet.dx = -packet.dx;
                packet.dy = -packet.dy;
              }
              packet.targetX = packet.x + packet.dx * 72;
              packet.targetY = packet.y + packet.dy * 72;
              packet.history.push({ x: packet.x, y: packet.y });
              if (packet.history.length > 6) packet.history.shift();
            }
          }
          const alpha = Math.min(
            1,
            packet.age / 0.8,
            (packet.life - packet.age) / 0.8,
          );
          const x = Math.round((packet.x - 12) / 24) * 24 + 12;
          const y = Math.round((packet.y - 12) / 24) * 24 + 12;
          const key = `${x},${y}`;
          if (key !== packet.lastDot) {
            packet.lastDot = key;
            trails.push({ x, y, t: elapsed, alpha });
          }
        }
      for (let index = trails.length - 1; index >= 0; index--) {
        const trail = trails[index],
          fade = 1 - (elapsed - trail.t) / 1.6;
        if (fade <= 0) {
          trails.splice(index, 1);
          continue;
        }
        if (!reduced) {
          ctx.fillStyle = `rgba(11,92,84,${0.75 * fade * trail.alpha})`;
          ctx.beginPath();
          ctx.arc(trail.x, trail.y, 1.3 + 0.9 * fade, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    const observer = new ResizeObserver(() => {
      const changed =
        width !== board.clientWidth || height !== board.clientHeight;
      resize();
      if (changed) {
        packets.splice(
          0,
          packets.length,
          ...Array.from({ length: 6 }, makePacket),
        );
        trails.length = 0;
        pointer = null;
        smooth.strength = 0;
      }
      if (reduced) draw(performance.now());
    });
    observer.observe(board);
    const motionChange = () => {
      reduced = media.matches;
      cancelAnimationFrame(frame);
      previous = performance.now();
      frame = requestAnimationFrame(draw);
    };
    media.addEventListener("change", motionChange);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener("change", motionChange);
      board.removeEventListener("pointermove", move);
      board.removeEventListener("pointerleave", leave);
    };
  }, []);
  return (
    <canvas
      ref={ref}
      className="drafting-board-ground"
      aria-hidden="true"
      data-decoration="drafting-dots"
    />
  );
}
