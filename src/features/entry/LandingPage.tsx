import * as React from "react";
import {
  ArrowRight,
  ArrowUp,
  Hand,
  MousePointer2,
  Pause,
  Pencil,
  Play,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PublicHeader } from "@/components/ui/public-header";
import {
  CanvasOneFace,
  type FaceExpression,
} from "@/components/ui/canvas-one-face";
import { DraftingBoard, DraftingStage } from "@/components/ui/drafting-board";
import { Reveal, RevealScope } from "@/components/ui/reveal";
import "./landing-page.css";
import { formatRoute } from "@/lib/router";
import { motionOff } from "@/lib/motion/env";

type Point = { x: number; y: number };
const initialNodes: Record<string, Point> = {
  "ING-01": { x: 960, y: 140 },
  "GW-01": { x: 960, y: 280 },
  "BUF-01": { x: 960, y: 420 },
  "WRK-04": { x: 960, y: 580 },
};
const request =
  "Add a buffer between the gateway and workers so p99 holds under Poisson spikes.";
const curve = (a: Point, height: number, b: Point) =>
  `M ${a.x + 100} ${a.y + height} C ${a.x + 100} ${(a.y + height + b.y) / 2} ${b.x + 100} ${(a.y + height + b.y) / 2} ${b.x + 100} ${b.y}`;

export function LandingPage({ basePath }: { basePath?: string } = {}) {
  const [paused, setPaused] = React.useState(false),
    [time, setTime] = React.useState(0);
  const [override, setOverride] = React.useState<
    "accepted" | "dismissed" | null
  >(null);
  const [nodes, setNodes] = React.useState(initialNodes),
    [hero, setHero] = React.useState({ x: 104, y: 248, w: 760, h: 146 });
  const drag = React.useRef<{
    start: Point;
    point: Point;
    id: string;
    resize?: string;
    width: number;
    height: number;
    scale: number;
  } | null>(null);
  const [reduced, setReduced] = React.useState(
    () => typeof window !== "undefined" && (matchMedia("(prefers-reduced-motion: reduce)").matches || motionOff()),
  );
  React.useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches || motionOff());
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  React.useEffect(() => {
    if (paused || reduced) return;
    const timer = setInterval(() => setTime((value) => value + 100), 100);
    return () => clearInterval(timer);
  }, [paused, reduced]);
  const t = reduced
    ? 9000
    : override === "accepted"
      ? Math.min(time, 9000)
      : time % 14000;
  const accepted =
    override === "accepted" ||
    (override !== "dismissed" && t >= 7200 && t < 13200);
  const visible =
    override !== "dismissed" &&
    (override === "accepted" || (t >= 3800 && t < 13200));
  const noteVisible = visible && (t >= 4800 || accepted);
  const q = accepted
    ? Math.max(0, Math.round(1800 * (1 - (t - 7200) / 1800)))
    : Math.round(300 + (Math.min(t, 7200) / 7200) * 1500);
  const p99 = accepted
    ? Math.round(180 - Math.min(1, Math.max(0, (t - 7200) / 1800)) * 138)
    : 180;
  const prompt =
    t >= 3000
      ? accepted
        ? "Buffer accepted. Queue drained, p99 180 → 42 ms."
        : "Claude is drafting on the sheet…"
      : request.slice(0, Math.max(0, Math.floor((t - 300) / 32))) ||
        "Ask Claude to change the system…";
  const edges = [
    {
      id: "ingress",
      d: curve(nodes["ING-01"], 69, nodes["GW-01"]),
      color: "var(--primary)",
      duration: 1.6,
      count: 3,
    },
    ...(!accepted
      ? [
          {
            id: "direct",
            d: curve(nodes["GW-01"], 69, nodes["WRK-04"]),
            color: "var(--risk)",
            duration: 3.2,
            count: 2,
          },
        ]
      : []),
    ...(visible
      ? [
          {
            id: "buffer-in",
            d: curve(nodes["GW-01"], 69, nodes["BUF-01"]),
            color: accepted ? "var(--primary)" : "var(--branch)",
            duration: 1.1,
            count: accepted ? 2 : 0,
          },
          {
            id: "buffer-out",
            d: curve(nodes["BUF-01"], accepted ? 68 : 102, nodes["WRK-04"]),
            color: accepted ? "var(--primary)" : "var(--branch)",
            duration: 1.1,
            count: accepted ? 2 : 0,
          },
        ]
      : []),
  ];
  const reset = () => {
    setTime(0);
    setOverride(null);
    setNodes(initialNodes);
    setHero({ x: 104, y: 248, w: 760, h: 146 });
  };
  const startDrag = (
    event: React.PointerEvent,
    id: string,
    resize?: string,
  ) => {
    if (
      innerWidth < 1000 ||
      (!resize && (event.target as HTMLElement).closest("button"))
    )
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const board = event.currentTarget
      .closest(".drafting-stage")!
      .getBoundingClientRect();
    drag.current = {
      start: { x: event.clientX, y: event.clientY },
      point: id === "hero" ? hero : nodes[id],
      id,
      resize,
      width: hero.w,
      height: hero.h,
      scale: board.width / 1440,
    };
  };
  const moveDrag = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const dx = (event.clientX - current.start.x) / current.scale,
      dy = (event.clientY - current.start.y) / current.scale;
    if (current.id === "hero") {
      const left = current.resize?.includes("L"),
        top = current.resize?.includes("T");
      const w = current.resize
        ? Math.max(240, Math.min(1300, current.width + (left ? -dx : dx)))
        : current.width;
      const h = current.resize
        ? Math.max(90, Math.min(700, current.height + (top ? -dy : dy)))
        : current.height;
      setHero({
        x:
          current.point.x +
          (current.resize ? (left ? current.width - w : 0) : dx),
        y:
          current.point.y +
          (current.resize ? (top ? current.height - h : 0) : dy),
        w,
        h,
      });
    } else
      setNodes((value) => ({
        ...value,
        [current.id]: {
          x: Math.max(40, Math.min(1200, current.point.x + dx)),
          y: Math.max(100, Math.min(680, current.point.y + dy)),
        },
      }));
  };
  const pointerProps = {
    onPointerMove: moveDrag,
    onPointerUp: () => {
      drag.current = null;
    },
    onPointerCancel: () => {
      drag.current = null;
    },
  };
  const you =
    t >= 5800 && t < 8200
      ? { x: nodes["BUF-01"].x + 44, y: nodes["BUF-01"].y + 82 }
      : t >= 8200 && t < 13200
        ? { x: 820, y: 640 }
        : { x: 870, y: 810 };
  const claude =
    t < 3000
      ? { x: 440, y: 798, action: "reading" }
      : t < 4800
        ? {
            x: nodes["BUF-01"].x + 150,
            y: nodes["BUF-01"].y + 40,
            action: "drafting BUF-01",
          }
        : t < 7200
          ? {
              x: nodes["BUF-01"].x + 250,
              y: nodes["BUF-01"].y + 30,
              action: "writing note",
            }
          : {
              x: nodes["WRK-04"].x + 180,
              y: nodes["WRK-04"].y + 60,
              action: "running sim",
            };
  const aiActive = t >= 3000 && !accepted;
  const aiExpression: FaceExpression = aiActive
    ? t < 4800
      ? "squint"
      : t < 7200
        ? "thought"
        : "pixel"
    : "base";
  return (
    <RevealScope contentCount={4}>
      <DraftingBoard paused={paused}>
        <PublicHeader
          basePath={basePath}
          page="landing"
          className="lp-header"
          collaborators={
            <>
              <span
                className="lp-collaborators"
                aria-label="Illustrative collaborators"
              >
                <span className="lp-avatars">
                  <i>Y</i>
                  <i>
                    <CanvasOneFace
                      expression={aiExpression}
                      size={18}
                      animate={!paused && !reduced}
                    />
                  </i>
                </span>
                <b>You &amp; Claude</b>
                <small>
                  <i />
                  Live
                </small>
              </span>
              <span className="lp-divider" />
            </>
          }
        />
        <DraftingStage>
          <main
            data-testid="landing-page"
            className="relative min-[1000px]:pointer-events-none min-[1000px]:absolute min-[1000px]:inset-0 min-[1000px]:[&>*]:pointer-events-auto"
          >
            <Reveal
              kind="content"
              index={0}
              className="lp-hero"
              style={{
                left: hero.x,
                top: hero.y,
                width: hero.w,
                height: hero.h,
              }}
              onPointerDown={(event) => startDrag(event, "hero")}
              {...pointerProps}
            >
              <span className="lp-dimension" aria-hidden="true">
                Text · H1 · {Math.round(hero.w)} × {Math.round(hero.h)}
                <span className="lp-dimension-hint"> · Drag to move</span>
              </span>
              <h1 tabIndex={-1} className="outline-none">
                Stop prompting in a box!
                <em>Collaborate visually with AI.</em>
              </h1>
              {["TL", "TR", "BL", "BR"].map((corner) => (
                <button
                  key={corner}
                  className={`lp-handle lp-handle-${corner}`}
                  aria-label={`Resize heading ${corner}`}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    startDrag(event, "hero", corner);
                  }}
                  onKeyDown={(event) => {
                    if (
                      [
                        "ArrowRight",
                        "ArrowLeft",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(event.key)
                    ) {
                      event.preventDefault();
                      setHero((value) => {
                        const dx =
                          event.key === "ArrowRight"
                            ? 8
                            : event.key === "ArrowLeft"
                              ? -8
                              : 0;
                        const dy =
                          event.key === "ArrowDown"
                            ? 8
                            : event.key === "ArrowUp"
                              ? -8
                              : 0;
                        const left = corner.includes("L"),
                          top = corner.includes("T");
                        const w = Math.max(
                          240,
                          Math.min(1300, value.w + (left ? -dx : dx)),
                        );
                        const h = Math.max(
                          90,
                          Math.min(700, value.h + (top ? -dy : dy)),
                        );
                        return {
                          x: left ? value.x + value.w - w : value.x,
                          y: top ? value.y + value.h - h : value.y,
                          w,
                          h,
                        };
                      });
                    }
                  }}
                  {...pointerProps}
                />
              ))}
            </Reveal>
            <Reveal
              as="p"
              kind="content"
              index={1}
              className="lp-copy"
              style={{ left: hero.x + 19, top: hero.y + hero.h + 36 }}
            >
              An open spatial workspace to map thoughts, connect concepts, and
              build ideas together—beyond text limits.
            </Reveal>
            <Reveal
              kind="content"
              index={2}
              className="lp-actions"
              style={{ left: hero.x + 18, top: hero.y + hero.h + 140 }}
            >
              <Button asChild className="lp-beta">
                <a href={formatRoute({ kind: "projects" }, basePath)}>
                  Try Beta <ArrowRight />
                </a>
              </Button>
              <div className="lp-command">
                <span aria-hidden="true">$</span>
                <code>npx canvas-one@preview</code>
                <Badge variant="neutral" className="lp-soon">
                  Coming soon
                </Badge>
              </div>
            </Reveal>
            <Reveal
              as="figure"
              kind="content"
              index={3}
              className="lp-demo"
              data-paused={paused}
              aria-label="Illustrative architecture and traffic, not measured results"
            >
              <svg
                className="lp-connections"
                viewBox="0 0 1440 900"
                aria-hidden="true"
              >
                {edges.map((edge) => (
                  <g key={edge.id}>
                    <path
                      data-edge={edge.id}
                      d={edge.d}
                      stroke={edge.color}
                      strokeDasharray={
                        edge.color === "var(--branch)" ? "4 4" : "3 3"
                      }
                      fill="none"
                    />
                    {!paused &&
                      !reduced &&
                      Array.from({ length: edge.count }, (_, i) => (
                        <circle key={i} r="3" fill={edge.color}>
                          <animateMotion
                            dur={`${edge.duration}s`}
                            repeatCount="indefinite"
                            path={edge.d}
                            begin={`${(-edge.duration / edge.count) * i}s`}
                          />
                        </circle>
                      ))}
                  </g>
                ))}
              </svg>
              <svg
                className="lp-mobile-connections"
                viewBox="0 0 320 740"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {edges.map((edge) => {
                  const endpoints: Record<string, [number, number]> = {
                    ingress: [69, 140],
                    direct: [209, 440],
                    "buffer-in": [209, 280],
                    "buffer-out": [accepted ? 348 : 382, 440],
                  };
                  const [from, to] = endpoints[edge.id];
                  const d = `M 160 ${from} V ${to}`;
                  return (
                    <g key={edge.id}>
                      <path
                        d={d}
                        fill="none"
                        stroke={edge.color}
                        strokeDasharray={
                          edge.color === "var(--branch)" ? "4 4" : "3 3"
                        }
                      />
                      {!paused &&
                        !reduced &&
                        Array.from({ length: edge.count }, (_, i) => (
                          <circle key={i} r="3" fill={edge.color}>
                            <animateMotion
                              dur={`${edge.duration}s`}
                              repeatCount="indefinite"
                              path={d}
                              begin={`${(-edge.duration / edge.count) * i}s`}
                            />
                          </circle>
                        ))}
                    </g>
                  );
                })}
              </svg>
              {[
                {
                  id: "ING-01",
                  title: "Client Ingress",
                  label: "Throughput",
                  value: "1,200 req/s",
                },
                {
                  id: "GW-01",
                  title: "Edge Gateway",
                  label: "Queue",
                  value: q === 0 ? "0 dropped" : `${(q / 1000).toFixed(1)}k ▲`,
                },
                {
                  id: "BUF-01",
                  title: "Async Buffer",
                  label: "BUF-01",
                  value: "Zero-Copy Bus",
                },
                {
                  id: "WRK-04",
                  title: "Worker Pool",
                  label: "P99 Latency",
                  value: `${p99} ms`,
                },
              ].map((node) =>
                node.id === "BUF-01" && !visible ? null : (
                  <div
                    key={node.id}
                    className={`lp-node ${node.id === "BUF-01" ? (accepted ? "lp-buffer accepted" : "lp-buffer suggested") : ""}`}
                    style={{ left: nodes[node.id].x, top: nodes[node.id].y }}
                    tabIndex={0}
                    aria-label={`Move ${node.title} demo node`}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (
                        [
                          "ArrowRight",
                          "ArrowLeft",
                          "ArrowUp",
                          "ArrowDown",
                        ].includes(event.key)
                      ) {
                        event.preventDefault();
                        setNodes((value) => ({
                          ...value,
                          [node.id]: {
                            x: Math.max(
                              40,
                              Math.min(
                                1200,
                                value[node.id].x +
                                  (event.key === "ArrowRight"
                                    ? 8
                                    : event.key === "ArrowLeft"
                                      ? -8
                                      : 0),
                              ),
                            ),
                            y: Math.max(
                              100,
                              Math.min(
                                680,
                                value[node.id].y +
                                  (event.key === "ArrowDown"
                                    ? 8
                                    : event.key === "ArrowUp"
                                      ? -8
                                      : 0),
                              ),
                            ),
                          },
                        }));
                      }
                    }}
                    {...pointerProps}
                  >
                    <header
                      onPointerDown={(event) => startDrag(event, node.id)}
                    >
                      {node.id === "BUF-01" && <Sparkles />}
                      <b>{node.title}</b>
                      <span>
                        {node.id === "BUF-01"
                          ? accepted
                            ? "Accepted"
                            : "Suggested"
                          : node.id}
                      </span>
                    </header>
                    <p>
                      <span>{node.label}</span>
                      <strong
                        className={
                          (node.id === "GW-01" && q > 0) ||
                          (node.id === "WRK-04" && p99 >= 60)
                            ? "lp-hot"
                            : ""
                        }
                      >
                        {node.value}
                      </strong>
                    </p>
                    {node.id === "BUF-01" && !accepted && (
                      <div className="lp-buffer-actions">
                        <Button
                          onClick={() => {
                            setOverride("accepted");
                            setTime(7200);
                          }}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setOverride("dismissed")}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                ),
              )}
              {noteVisible && (
                <aside
                  className="lp-note"
                  style={{
                    left: nodes["BUF-01"].x + 236,
                    top: nodes["BUF-01"].y - 10,
                  }}
                >
                  <b>Agent Claude · Note</b>
                  <p>
                    Decoupled Edge Gateway from Worker Pool via Async Buffer (
                    <strong>BUF-01</strong>). Prevents backpressure cascade
                    during Poisson spikes.
                  </p>
                </aside>
              )}
            </Reveal>
          </main>
          <Reveal
            kind="chrome"
            index={3}
            className="relative min-[1000px]:pointer-events-none min-[1000px]:absolute min-[1000px]:inset-0 min-[1000px]:[&>*]:pointer-events-auto"
          >
            <div
              className="lp-toolbar"
              role="region"
              aria-label="Demo controls"
            >
              <span className="lp-select" title="Select">
                <MousePointer2 />
              </span>
              <span title="Pan">
                <Hand />
              </span>
              <span title="Draw">
                <Pencil />
              </span>
              <i />
              <Button
                aria-label={paused ? "Run demo" : "Pause demo"}
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play /> : <Pause />}
                {paused ? "Run 100µs" : "Pause"}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Reset demo"
                onClick={reset}
              >
                <RotateCcw />
              </Button>
            </div>
            <div
              className={`lp-prompt ${aiActive ? "lp-prompt-active" : ""}`}
              role="region"
              aria-label="Collaboration prompt"
            >
              <Sparkles />
              <span
                style={{
                  color:
                    t >= 3000
                      ? "var(--branch-text)"
                      : t >= 332
                        ? "var(--foreground)"
                        : "var(--secondary-text)",
                }}
              >
                {prompt}
              </span>
              <small>@ 2 nodes</small>
              <Button
                size="icon"
                aria-label="Replay collaboration demo"
                onClick={() => {
                  reset();
                  setPaused(false);
                }}
              >
                {aiActive ? (
                  <CanvasOneFace
                    expression={aiExpression}
                    size={30}
                    animate={!paused && !reduced}
                  />
                ) : (
                  <ArrowUp />
                )}
              </Button>
            </div>
            <footer className="lp-local">
              <div>Infinite workspace</div>
              <div>Real-time AI partner</div>
              <div>100% browser-local</div>
            </footer>
          </Reveal>
          <Reveal
            kind="chrome"
            index={4}
            className="pointer-events-none absolute inset-0"
          >
            {[
              { name: "You", ...you },
              { name: claude.action, ...claude },
            ].map((cursor, index) => (
              <div
                key={index}
                className={`lp-cursor ${index ? "lp-claude" : ""}`}
                style={{
                  left: cursor.x,
                  top: cursor.y,
                  opacity: index && (t < 2900 || t >= 13200) ? 0 : 1,
                }}
                aria-hidden="true"
              >
                <svg width="18" height="20" viewBox="0 0 18 20">
                  <path
                    d="M1 1 L1 16 L5 12 L8 19 L11 18 L8 11 L14 11 Z"
                    fill={index ? "var(--branch-solid)" : "var(--primary)"}
                    stroke="white"
                    strokeWidth="1.2"
                  />
                </svg>
                <span>
                  {index === 1 && (
                    <CanvasOneFace
                      expression={aiExpression}
                      size={16}
                      animate={!paused && !reduced}
                    />
                  )}
                  {cursor.name}
                </span>
              </div>
            ))}
          </Reveal>
        </DraftingStage>
      </DraftingBoard>
    </RevealScope>
  );
}
