import { useEffect, useState, type ReactNode } from "react";
import { ArrowUp, MousePointer2, Pause, Play } from "lucide-react";
import { m } from "motion/react";
import { useMotionEnv } from "@/lib/motion/env";
import { CanvasOneFace } from "@/components/ui/canvas-one-face";
import { Button } from "@/components/ui/button";
import { DraftingSheet } from "@/components/ui/drafting-sheet";
import { Reveal, RevealScope } from "@/components/ui/reveal";
import { EASE } from "@/lib/motion/tokens";
import "./brand-page.css";

const expressions = [
  ["base", "Ready", "Idle · AI available"],
  ["wink", "Thinking", "First response pending"],
  ["look", "Reading the board", "Gathering context"],
  ["squint", "Working", "Long task · over 5s"],
  ["pixel", "Checking", "Analysing a selection"],
  ["thought", "Brainstorming", "Generating ideas"],
  ["reply", "Suggestion ready", "Output to review"],
  ["round", "Chat", "Conversation open"],
  ["antenna", "Connecting", "Joining · syncing"],
  ["listen", "Listening", "Voice input on"],
  ["wait", "Your turn", "Needs input"],
  ["happy", "Done", "Task complete"],
  ["error", "Error", "Request failed"],
  ["sleep", "Offline", "No connection"],
  ["empty", "Empty board", "Nothing selected"],
] as const;
type Expression = (typeof expressions)[number][0];
const flow: { expression: Expression; label: string; duration: number }[] = [
  { expression: "base", label: "Ready", duration: 1600 },
  { expression: "look", label: "Reading 12 items", duration: 1800 },
  { expression: "wink", label: "Thinking", duration: 1600 },
  { expression: "squint", label: "Grouping 48 stickies", duration: 2600 },
  { expression: "reply", label: "3 groups suggested", duration: 2200 },
  { expression: "happy", label: "Done · 3 groups added", duration: 2000 },
];
const launch: {
  expression: Expression;
  label: string;
  progress: number;
  duration: number;
}[] = [
  { expression: "sleep", label: "Offline", progress: 0, duration: 1000 },
  { expression: "base", label: "Starting", progress: 15, duration: 900 },
  { expression: "antenna", label: "Connecting", progress: 45, duration: 1500 },
  {
    expression: "look",
    label: "Loading board · Q3 planning",
    progress: 85,
    duration: 1600,
  },
  { expression: "base", label: "Ready", progress: 100, duration: 1400 },
];
const sections = [
  "Logo",
  "App icon",
  "Colour",
  "Type",
  "Expressions",
  "Motion",
  "Transitions",
  "In the app",
  "Loading",
  "Usage",
];
const ids = [
  "logo",
  "icon",
  "colour",
  "type",
  "states",
  "motion",
  "transitions",
  "inapp",
  "loading",
  "usage",
];
const face = (expression: Expression = "base", size = 48, animate = false, transition = animate) => (
  <CanvasOneFace expression={expression} size={size} animate={animate} transition={transition} />
);
function Section({
  index,
  description,
  children,
}: {
  index: number;
  description: string;
  children: ReactNode;
}) {
  const env = useMotionEnv();
  return (
    <section
      id={ids[index]}
      className="brand-section"
      aria-labelledby={`brand-heading-${index}`}
    >
      <m.div className="brand-section-heading" initial={env.off || env.reduced ? false : { opacity: 0, y: 18, filter: 'blur(8px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true, margin: '0px 0px -12% 0px' }} transition={{ duration: env.off ? 0 : 0.9, ease: EASE.enter }}>
        <span className="brand-meta">{String(index + 1).padStart(2, "0")}</span>
        <h2 id={`brand-heading-${index}`}>{sections[index]}</h2>
        <p>{description}</p>
      </m.div>
      <m.div className="brand-section-content" initial={env.off || env.reduced ? false : { opacity: 0, y: 18, filter: 'blur(8px)' }} whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }} viewport={{ once: true, margin: '0px 0px -12% 0px' }} transition={{ duration: env.off ? 0 : 0.9, delay: env.off || env.reduced ? 0 : 0.07, ease: EASE.enter }}>{children}</m.div>
    </section>
  );
}
function Specimen({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`brand-specimen ${className}`}>
      <div className="brand-specimen-stage">{children}</div>
      <div className="brand-specimen-caption">{label}</div>
    </div>
  );
}
function Status({
  expression,
  label,
  animate,
  transition = animate,
}: {
  expression: Expression;
  label: string;
  animate: boolean;
  transition?: boolean;
}) {
  return (
    <span className="brand-status">
      {face(expression, 16, animate, transition)}
      <span>{label}</span>
    </span>
  );
}
function Cursor({
  expression,
  label,
  animate,
  transition = animate,
  callout,
}: {
  expression: Expression;
  label: string;
  animate: boolean;
  transition?: boolean;
  callout?: number;
}) {
  return (
    <div className="brand-cursor">
      <MousePointer2 size={22} fill="var(--branch-solid)" stroke="white" />
      <span className="brand-cursor-tag">
        <span className="brand-cursor-label">{face(expression, 16, animate, transition)}{label.toLowerCase()}</span>
        {callout && <span className="brand-callout">{callout}</span>}
      </span>
    </div>
  );
}
function AppLaunch({ motion, playing }: { motion: boolean; playing: boolean }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(false);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  useEffect(() => {
    if (!motion || !playing || !visible) return;
    const timer = setTimeout(() => setIndex(i => (i + 1) % launch.length), launch[index].duration);
    return () => clearTimeout(timer);
  }, [motion, playing, visible, index]);
  const splash = launch[index];
  return <div ref={setElement} className="brand-expression">
    {face(splash.expression, 72, motion && playing)}
    <strong className="brand-splash-title">Canvas One</strong>
    <span className="brand-meta">{splash.label}</span>
    <progress aria-label="Example app launch progress" value={splash.progress} max={100} />
  </div>;
}
export function BrandPage({ animate = true }: { animate?: boolean }) {
  const [demosVisible, setDemosVisible] = useState(false);
  useEffect(() => {
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.setAttribute('data-in-view', String(entry.isIntersecting));
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setDemosVisible([...visible].some((section) => ['motion', 'transitions', 'inapp'].includes(section.id)));
    }, { root: document.querySelector('[data-page="brand"]'), rootMargin: '100px' });
    document.querySelectorAll('.brand-section, .brand-hero').forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [playing, setPlaying] = useState(animate && !reduced);
  const [flowIndex, setFlowIndex] = useState(0);
  const [pick, setPick] = useState<Expression>("base");
  const [terminalSettled, setTerminalSettled] = useState(false);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [lastLabel, setLastLabel] = useState('Ready');
  useEffect(() => {
    if (playing && flow[flowIndex].expression !== 'base') setLastLabel(flow[flowIndex].label);
  }, [flowIndex, playing]);
  useEffect(() => {
    setTerminalSettled(false);
    if (playing || (pick !== 'happy' && pick !== 'error')) return;
    const timer = setTimeout(() => setTerminalSettled(true), 2000);
    return () => clearTimeout(timer);
  }, [pick, playing, selectionRevision]);
  const [suggestion, setSuggestion] = useState<
    "pending" | "accepted" | "discarded"
  >("pending");
  const [hex, setHex] = useState<Record<string, string>>({});
  const motion = animate && !reduced;
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReduced(media.matches);
      if (media.matches) setPlaying(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!playing || !motion || !demosVisible) return;
    const timer = setTimeout(
      () => setFlowIndex((i) => (i + 1) % flow.length),
      flow[flowIndex].duration,
    );
    return () => clearTimeout(timer);
  }, [playing, motion, flowIndex, demosVisible]);
  useEffect(() => {
    const sync = () => {
      const css = getComputedStyle(document.documentElement);
      setHex(
        Object.fromEntries(
          ["ink", "primary", "branch", "risk", "shell", "desk"].map((t) => [
            t,
            css.getPropertyValue(`--${t}`).trim(),
          ]),
        ),
      );
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme', 'data-mode', 'data-palette'] });
    return () => observer.disconnect();
  }, []);
  const current = playing
    ? { ...flow[flowIndex], label: flow[flowIndex].expression === 'base' ? lastLabel : flow[flowIndex].label }
    : { expression: terminalSettled ? 'base' as Expression : pick, label: expressions.find((e) => e[0] === pick)![1] };
  const choose = (expression: Expression) => {
    setTerminalSettled(false);
    setSelectionRevision((revision) => revision + 1);
    setPlaying(false);
    setPick(expression);
  };
  return (
    <RevealScope contentCount={3}>
    <DraftingSheet
      page="brand"
    >
      <main className="brand-page">
        <section className="brand-hero">
          <div>
            <Reveal index={0}><h1 tabIndex={-1}>
              Canvas One
              <br />
              <em>brand guidelines.</em>
            </h1></Reveal>
            <Reveal as="p" index={1}>A whiteboard where people and AI work on the same canvas.</Reveal>
          </div>
          <Reveal index={2} className="brand-hero-face">{face("base", 220, motion)}</Reveal>
        </section>
        <Section
          index={0}
          description="A speech-bubble head with two eyes. The tail sits bottom-left, toward the person it is talking to. Outside the product the face is always neutral."
        >
          <div className="brand-grid brand-grid-two">
            <Specimen label="Horizontal · default">
              <div className="brand-lockup">
                {face("base", 44)}
                <strong>Canvas One</strong>
              </div>
            </Specimen>
            <Specimen label="Stacked">
              <div className="brand-lockup brand-lockup-stacked">
                {face("base", 56)}
                <strong>Canvas One</strong>
              </div>
            </Specimen>
            <Specimen label="On dark" className="brand-dark">
              <div className="brand-lockup">
                {face("base", 44)}
                <strong>Canvas One</strong>
              </div>
            </Specimen>
          </div>
          <div className="brand-grid brand-grid-two">
            <Specimen label="Clear space. Keep a margin of a quarter of the mark’s height on every side. Nothing else enters it.">
              <div className="brand-clearspace">{face("base", 120)}</div>
            </Specimen>
            <Specimen label="Minimum size. The mark holds to 16px. Below 20px, drop the wordmark and use the mark alone.">
              <div className="brand-sizes">
                {[16, 24, 48].map((size) => (
                  <div key={size}>
                    {face("base", size)}
                    <span>{size}PX</span>
                  </div>
                ))}
              </div>
            </Specimen>
          </div>
        </Section>
        <Section
          index={1}
          description="The neutral face reversed out of the brand colour. Corner radius is 23% of the icon size."
        >
          <div className="brand-grid brand-grid-two">
            {["Light", "Dark"].map((mode) => (
              <Specimen
                key={mode}
                label={`${mode} · 128 / 64 / 32 / 16`}
                className={mode === "Dark" ? "brand-dark" : ""}
              >
                <div className="brand-icon-sizes">
                  {[128, 64, 32, 16].map((size) => (
                    <div
                      key={size}
                      className="brand-app-icon"
                      style={{
                        width: size,
                        height: size,
                        borderRadius: size * 0.23,
                      }}
                    >
                      <CanvasOneFace
                        size={Math.round(size * 0.625)}
                        tone="icon"
                        animate={false}
                      />
                    </div>
                  ))}
                </div>
              </Specimen>
            ))}
          </div>
        </Section>
        <Section
          index={2}
          description="Colours come from the active theme. The head is always ink. The AI colour is only ever a detail inside an expression, never the whole mark."
        >
          <div className="brand-grid brand-grid-three">
            {[
              ["Ink", "ink", "The head and the wordmark."],
              ["Brand", "primary", "App icon ground and primary actions."],
              ["AI", "branch", "Small AI details inside expressions."],
              ["Risk", "risk", "The Error expression only."],
              ["Canvas", "shell", "Eyes, and the ground behind the logo."],
              ["Desk", "desk", "Outer page ground."],
            ].map(([name, token, use]) => (
              <div key={name} className="brand-specimen">
                <div
                  className="brand-swatch"
                  style={{ background: `var(--${token})` }}
                />
                <div className="brand-card-body">
                  <strong>{name}</strong>
                  <span className="brand-meta">
                    {token} · {hex[token]}
                  </span>
                  <p>{use}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>
        <Section index={3} description="A shared type system across the website and product.">
          <div className="brand-type-row">
            <strong className="brand-type-wordmark">Canvas One</strong>
            <p>
              <strong>IBM Plex Sans 600</strong>. The wordmark. Zero
              tracking.
            </p>
          </div>
          <div className="brand-type-row">
            <span className="brand-type-editorial">
              Think out loud, together.
            </span>
            <p>
              <strong>Newsreader 300</strong>. Editorial lines on the website
              and in documents.
            </p>
          </div>
          <div className="brand-type-row">
            <span className="brand-meta">
              12 ITEMS · 3 COLLABORATORS · 0.8S
            </span>
            <p>
              <strong>IBM Plex Mono</strong>. Interface text and controls.
              <strong> Martian Mono</strong> for counts, timestamps and metadata.
            </p>
          </div>
        </Section>
        <Section
          index={4}
          description="Inside the product, the same face tells you what the AI is doing. The head stays recognisable at every size."
        >
          <div className="brand-grid brand-grid-three">
            {expressions.map(([expression, name, trigger]) => (
              <Specimen key={expression} label={trigger}>
                <div className="brand-expression">
                  {face(expression, 56, motion && playing)}
                  <strong>{name}</strong>
                  <Status
                    expression={expression}
                    label={name}
                    animate={motion && playing}
                  />
                </div>
              </Specimen>
            ))}
          </div>
        </Section>
        <Section
          index={5}
          description="Only the eyes and small details move; the head stays still. Movements are short and never bounce. The splash screen uses the Thinking expression."
        >
          <div className="brand-grid brand-grid-two">
            <Specimen label="Opening canvas" className="brand-dark">
              <div className="brand-expression">
                {face("wink", 72, motion && playing)}
                <strong className="brand-splash-title">Canvas One</strong>
              </div>
            </Specimen>
            <Specimen label="Joining board · 3 here">
              <div className="brand-expression">
                {face("antenna", 72, motion && playing)}
                <strong className="brand-splash-title">Canvas One</strong>
              </div>
            </Specimen>
          </div>
        </Section>
        <Section
          index={6}
          description="Every change of expression happens behind a blink. The eyes close in 120ms, the face changes while they are shut, then they open on the new expression in 180ms. The head never jumps."
        >
          <div className="brand-player">
            <div className="brand-player-display brand-dots">
              {face(current.expression, 150, motion && playing, motion)}
              <Status {...current} animate={motion && playing} transition={motion} />
            </div>
            <div className="brand-player-controls">
              <div className="brand-player-title">
                <div>
                  <strong>Example flow</strong>
                  <p>“Group these stickies by theme”</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPick(flow[flowIndex].expression);
                    setPlaying(!playing);
                  }}
                >
                  {playing ? <Pause /> : <Play />}
                  {playing ? "Pause" : "Play flow"}
                </Button>
              </div>
              <ol className="brand-flow">
                {flow.map((step, i) => (
                  <li
                    key={step.expression}
                    data-active={playing && flowIndex === i}
                  >
                    <span className="brand-flow-dot" />
                    <span>{step.label}</span>
                    <span className="brand-meta">
                      {expressions.find((e) => e[0] === step.expression)![1]}
                    </span>
                  </li>
                ))}
              </ol>
              <span className="brand-meta">Or pick any expression</span>
              <div className="brand-picks">
                {expressions.map(([expression, name]) => (
                  <Button
                    key={expression}
                    size="sm"
                    variant={
                      !playing && pick === expression ? "tint" : "outline"
                    }
                    aria-pressed={!playing && pick === expression}
                    onClick={() => choose(expression)}
                  >
                    {name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="brand-grid brand-grid-three">
            {[
              "Hold for 600ms. Show each expression for at least 600ms so the face never flickers.",
              "Done and Error don’t last. They return to Ready after 2 seconds; the label stays until the next action.",
              "One state, everywhere. Status chip, cursor, avatar and prompt always show the same expression.",
            ].map((rule) => (
              <p className="brand-rule" key={rule}>
                {rule}
              </p>
            ))}
          </div>
        </Section>
        <Section
          index={7}
          description="The face appears where the AI is present. All live placements follow the same state."
        >
          <div className="brand-board-scroll">
            <div className="brand-board">
              <header>
                {face("base", 20)}
                <strong>Q3 planning</strong>
                <span>/ Retro board</span>
                <span className="brand-status-placement"><Status {...current} animate={motion && playing} transition={motion} /><span className="brand-callout">1</span></span>
                <div className="brand-presence">
                  <span>MK</span>
                  <span className="brand-ai-avatar">
                    {face(current.expression, 15, motion && playing, motion)}
                  </span>
                </div>
                <Button size="sm">Share</Button>
              </header>
              <div className="brand-board-body">
                <div className="brand-workspace brand-dots">
                  <div className="brand-selection" />
                  <div className="brand-stickies">
                    {[
                      "Standups run long",
                      "Too many tools",
                      "Unclear owners",
                      "Demo day helped",
                    ].map((note) => (
                      <div key={note}>{note}</div>
                    ))}
                  </div>
                  <div className="brand-groups">
                    <span className="brand-meta">Suggested · 3 groups</span>
                    {["Meetings", "Tooling", "Ownership"].map((group) => (
                      <div key={group}>{group}</div>
                    ))}
                  </div>
                  <div className="brand-cursor-placement"><Cursor {...current} animate={motion && playing} transition={motion} callout={2} /></div>
                  <div className="brand-suggestion">
                    <div className="brand-inline">
                      {face("reply", 20)}
                      <strong>
                        {suggestion === "pending"
                          ? "3 groups suggested"
                          : suggestion === "accepted"
                            ? "Done · 3 groups added"
                            : "Suggestion discarded"}
                      </strong>
                      <span className="brand-callout">3</span>
                    </div>
                    <div className="brand-inline">
                      {suggestion === "pending" ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setSuggestion("accepted")}
                          >
                            Accept
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSuggestion("discarded")}
                          >
                            Discard
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSuggestion("pending")}
                        >
                          Reset suggestion
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <aside className="brand-chat">
                  <header className="brand-chat-header">{face("round", 18)}<strong>Chat</strong><span className="brand-callout">4</span></header>
                  <div className="brand-chat-messages">
                  <div className="brand-chat-user">
                    Group these stickies by theme
                  </div>
                  <div className="brand-inline">
                    {face("base", 24)}
                    <p>I’ll look at the 12 stickies in your selection first.</p>
                  </div>
                  <div className="brand-inline">{face(current.expression, 24, motion && playing, motion)}<span>{current.label}</span></div>
                  </div>
                  <div className="brand-prompt"><span>Canvas One is working…</span><span className="brand-prompt-face">{face(current.expression, 28, motion && playing, motion)}</span></div>
                </aside>
              </div>
            </div>
          </div>
          <div className="brand-grid brand-grid-two">
            {[
              [
                "Status chip",
                "16px · top bar",
                "Always visible. Shows the live expression and a short label.",
              ],
              [
                "AI cursor",
                "16px face · name tag",
                "A standard arrow in the AI colour with a white keyline. The face sits in the name tag, never as the pointer.",
              ],
              [
                "Suggestion",
                "20px · on proposed content",
                "The Suggestion ready face sits on the card with Accept and Discard.",
              ],
              [
                "Chat and prompt",
                "24px · 28px send",
                "Past messages use the still Ready face. While working, the send button becomes the live face.",
              ],
            ].map(([name, size, description]) => (
              <div className="brand-placement" key={name}>
                <span className="brand-callout">{["Status chip", "AI cursor", "Suggestion", "Chat and prompt"].indexOf(name) + 1}</span><strong>{name}</strong>
                <span className="brand-meta">{size}</span>
                <p>{description}</p>
              </div>
            ))}
          </div>
          <div className="brand-grid brand-grid-three">
            <Specimen label="AI cursor">
              <Cursor
                expression="squint"
                label="drafting BUF-01"
                animate={motion && playing}
              />
            </Specimen>
            <Specimen label="Prompt input">
              <div className="brand-mini-prompt">
                Ask Canvas One… <ArrowUp size={20} />
              </div>
              <div className="brand-mini-prompt">
                Drafting on the sheet…{face("squint", 26, motion && playing)}
              </div>
            </Specimen>
            <Specimen label="Avatar">
              <div className="brand-presence">
                <span>Y</span>
                <span className="brand-ai-avatar">{face("base", 18)}</span>
              </div>
              <span>You &amp; Canvas One</span>
            </Specimen>
          </div>
        </Section>
        <Section
          index={8}
          description="Opening the app wakes the face up. Inside the app the wait time decides what you see."
        >
          <Specimen label="App launch · offline → ready → connecting → reading → ready">
            <AppLaunch motion={motion} playing={playing} />
          </Specimen>
          <div className="brand-grid brand-grid-three">
            <Specimen label="400ms–5s · thinking">
              <Status
                expression="wink"
                label="Thinking"
                animate={motion && playing}
              />
            </Specimen>
            <Specimen label="Over 5s · working">
              <div className="brand-working"><div className="brand-inline">{face("squint", 20, motion && playing)}<span>Grouping 48 stickies</span><span className="brand-meta">12s</span></div><progress aria-label="Example grouping progress" value={62} max={100} /></div>
            </Specimen>
            <Specimen label="Board or panel · reading">
              {face("look", 32, motion && playing)}
              <div className="brand-skeleton">
                <span />
                <span />
              </div>
            </Specimen>
          </div>
          <p>
            Under 400ms, show nothing. Long tasks get a progress bar and elapsed
            time, and can be cancelled. Panels that wait on AI content show
            placeholder lines next to the Reading face.
          </p>
        </Section>
        <Section index={9} description="Use the logo as drawn.">
          <div className="brand-grid brand-grid-three">
            {[
              ["Don’t stretch or squash the mark.", "base", "stretch"],
              ["Don’t flip the tail to the right.", "base", "flip"],
              ["Don’t recolour the eyes.", "base", "eyes"],
              ["Don’t fill the head with the AI colour.", "base", "ai"],
              [
                "Don’t add a mouth or extra features to the logo.",
                "base",
                "mouth",
              ],
              [
                "Don’t use an expression as the logo outside the product.",
                "squint",
                "",
              ],
              [
                "Don’t use the face on its own as a cursor. Put it in the name tag.",
                "base",
                "upside",
              ],
            ].map(([label, expression, kind]) => (
              <Specimen key={label} label={`✕ ${label}`}>
                <div className={`brand-dont brand-dont-${kind}`}>
                  {face(expression as Expression, 72)}
                  {kind === "mouth" && <span className="brand-bad-mouth" />}
                </div>
              </Specimen>
            ))}
          </div>
        </Section>
      </main>
    </DraftingSheet>
    </RevealScope>
  );
}
