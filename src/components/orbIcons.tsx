import { useId } from "react";
import type React from "react";
import type { StatusIcon } from "../types";

/** What the orb shows. One value drives the color, the icon and the motion. */
export type Mood = "ok" | "warn" | "alarm" | "offline" | "busy" | "idle";

export const ORB_STYLE_LABEL: Record<StatusIcon, string> = {
  rings: "Rings",
  pulse: "Pulse",
};

// ---------- Rings: concentric rings are the brand's "signal" mark ----------
// Their count and dash style carry the mood. Paths carry pathLength so the CSS can draw
// them in.
const RINGS_OK = (
  <>
    <circle className="rg" cx="12" cy="12" r="3.2" opacity="1" />
    <circle className="rg" cx="12" cy="12" r="6.8" opacity="0.7" />
    <circle className="rg" cx="12" cy="12" r="10.6" opacity="0.4" />
  </>
);
const RINGS_ALARM = (
  <>
    <circle className="rg" cx="12" cy="12" r="3.2" opacity="0.7" strokeDasharray="2 2" />
    <circle className="rg" cx="12" cy="12" r="6.8" opacity="0.38" strokeDasharray="2.6 2.4" />
    <circle className="rg" cx="12" cy="12" r="10.6" opacity="0.18" strokeDasharray="3.4 2.8" />
  </>
);
// Offline: a bold Wi-Fi whose first dot is the dot of a "!", the same in every style. The three arcs
// (they span the rings' 21-unit width as a 90° wedge over one focal point) switch on one after
// another, hold, then all go dark (`.sq1`–`.sq3`, see App.css); the "!" and its dot stay still. The
// "!" casts a soft shadow: a blurred, doubled strip cut out of the arcs, so they fade out around it
// instead of ending in a hard edge.
const wifiOff = (gid: string) => (
  <>
    <defs>
      <filter id={`${gid}-sf`} filterUnits="userSpaceOnUse" x="-6" y="-6" width="36" height="36">
        <feGaussianBlur stdDeviation="1.9" />
      </filter>
      <mask id={`${gid}-cut`} maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32">
        <rect x="-4" y="-4" width="32" height="32" fill="#fff" stroke="none" />
        <path d="M12 4.4V12" stroke="#000" strokeWidth="7.4" filter={`url(#${gid}-sf)`} />
        <path d="M12 4.4V12" stroke="#000" strokeWidth="5.7" filter={`url(#${gid}-sf)`} />
      </mask>
    </defs>
    <g mask={`url(#${gid}-cut)`} strokeWidth="2.4">
      <path className="sq1" d="M7.76 15.26A6 6 0 0 1 16.24 15.26" />
      <path className="sq2" d="M4.58 12.08A10.5 10.5 0 0 1 19.42 12.08" />
      <path className="sq3" d="M1.39 8.89A15 15 0 0 1 22.61 8.89" />
    </g>
    <path d="M12 4.4V11.8" strokeWidth="2.6" />
    <path d="M12 19.5h.01" strokeWidth="3.6" />
  </>
);
const RINGS: Record<Exclude<Mood, "offline">, React.ReactNode> = {
  ok: RINGS_OK,
  busy: RINGS_OK,
  idle: RINGS_OK,
  warn: (
    <>
      <circle className="rg" cx="12" cy="12" r="6.8" opacity="0.55" />
      <circle className="rg" cx="12" cy="12" r="10.6" opacity="0.3" strokeDasharray="2.6 2.4" />
      <path pathLength={1} d="M12 9v3.6" strokeWidth="2" />
      <path pathLength={1} d="M12 15.6h.01" strokeWidth="2.4" />
    </>
  ),
  alarm: RINGS_ALARM,
};

// ---------- Pulse: a canary heartbeat ----------
// One ECG line, drawn as a smooth gradient that fades to nothing at both ends. A soft light runs
// along it the way a monitor's trace does: it slides in from beyond the left end, rushes up and down
// the beat, slides out past the right end — and it drags a tail that fades behind it. It then rests
// *off the line*, out of sight, until the next beat (so it never sits stuck on the end). Calm = a clean beat, warn = a shallower, faster one, alarm = a heartbeat that stutters and drains into a flat line
// marked with an X. Offline is the shared Wi-Fi-off icon, not a line.
//
// The light is a few radial-gradient dots that SVG moves along the heartbeat's own path
// (<animateMotion>), each a little later than the one before, so the tail stretches where the light
// is fast and bunches where it is slow. They are shown only where the line is (a mask of the line
// itself, which also carries the end fade). Each icon instance needs its own ids, so every Pulse
// entry is a function of an id; Rings ignore it.
type Pt = readonly [number, number];
// The line runs from X0 to X1 — a little past the 24-unit box on both sides, out to the orb's edge —
// and fades to nothing at both ends, so the flat stretches either side of the beat read as long.
const X0 = -1.5;
const X1 = 25.5;
const BEAT_OK: Pt[] = [[X0, 12], [5, 12], [9, 3], [15.5, 21], [19, 12], [X1, 12]];
const BEAT_WARN: Pt[] = [[X0, 12], [8.5, 12], [11, 8], [15, 16], [17.5, 12], [X1, 12]];
const FLAT_LINE = `M${X0} 12H${X1}`;
const toPath = (pts: readonly Pt[]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");

/** Where along the path (0..1, by length) each vertex sits. */
function fractions(pts: readonly Pt[]): number[] {
  const seg = pts.slice(1).map(([x, y], i) => Math.hypot(x - pts[i][0], y - pts[i][1]));
  const total = seg.reduce((a, b) => a + b, 0);
  let run = 0;
  return [0, ...seg.map((l) => (run += l) / total)];
}

/** The light's tail: dot i trails the head by `DELAY` × i, is a bit smaller and a bit fainter. */
const TAIL = [
  { r: 4.4, a: 1 },
  { r: 4.1, a: 0.85 },
  { r: 3.8, a: 0.72 },
  { r: 3.5, a: 0.6 },
  { r: 3.2, a: 0.48 },
  { r: 2.9, a: 0.38 },
  { r: 2.6, a: 0.28 },
  { r: 2.3, a: 0.2 },
  { r: 2.0, a: 0.12 },
  { r: 1.8, a: 0.06 },
];
const DELAY = 0.05; // seconds between one dot and the next

/** The end-fade gradient, and — for a heartbeat that glides — the glow's gradient and line mask. */
const pulseDefs = (gid: string, line?: string, extra?: React.ReactNode) => (
  <defs>
    {/* Clear at both ends, solid in the middle. */}
    <linearGradient id={`${gid}-fade`} gradientUnits="userSpaceOnUse" x1={X0} y1="0" x2={X1} y2="0">
      <stop offset="0" stopColor="#fff" stopOpacity="0" />
      <stop offset="0.15" stopColor="#fff" stopOpacity="0.9" />
      <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
      <stop offset="0.85" stopColor="#fff" stopOpacity="0.9" />
      <stop offset="1" stopColor="#fff" stopOpacity="0" />
    </linearGradient>
    {line && (
      <>
        {/* The glow: solid in the middle, fading smoothly to nothing at its edge. */}
        <radialGradient id={`${gid}-glow`}>
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.45" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        {/* Shows the light only on the line itself (and only as strongly as the end fade allows). */}
        <mask id={`${gid}-line`} maskUnits="userSpaceOnUse" x="-4" y="0" width="32" height="24">
          <path
            className="pulse-maskline"
            d={line}
            fill="none"
            stroke={`url(#${gid}-fade)`}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </>
    )}
    {extra}
  </defs>
);

/** How far past each end of the line the light starts and finishes (so it enters and leaves). */
const RUNWAY = 10;
/** The beat is run this much faster than the flat stretches either side of it. */
const BEAT_SPEED = 1.7;
/** The share of one cycle the light is travelling; the rest of it is the rest, off the line. */
const ACTIVE = 0.72;

/**
 * The light's timing, as `keyPoints` / `keyTimes` for <animateMotion>, over the path it runs on
 * (the line with a runway at each end). It moves at one steady speed along the flat stretches
 * and BEAT_SPEED times that through the beat, so the speed changes only where the shape does; it
 * ends beyond the line's right end and stays there, unseen, for the rest of the cycle.
 */
function glideTiming(run: readonly Pt[]) {
  const f = fractions(run);
  // Vertices of the run: [runway start, line start, beat start, …, beat end, line end, runway end].
  const beatStart = f[2];
  const beatEnd = f[run.length - 3];
  const times = [beatStart, (beatEnd - beatStart) / BEAT_SPEED, 1 - beatEnd];
  const total = times.reduce((a, b) => a + b, 0);
  const k0 = (times[0] / total) * ACTIVE;
  const k1 = k0 + (times[1] / total) * ACTIVE;
  const fmt = (v: number) => v.toFixed(4);
  return {
    keyPoints: [0, beatStart, beatEnd, 1, 1].map(fmt).join(";"),
    keyTimes: [0, k0, k1, ACTIVE, 1].map(fmt).join(";"),
  };
}

/** The heartbeat. `dur` = one whole cycle, rest included; `undefined` = no light (reduced motion). */
const trace = (pts: readonly Pt[], gid: string, dur?: string) => {
  const d = toPath(pts);
  // The path the light runs on: the line itself, plus a runway of empty air at each end.
  const run: Pt[] = [[pts[0][0] - RUNWAY, pts[0][1]], ...pts, [pts[pts.length - 1][0] + RUNWAY, pts[pts.length - 1][1]]];
  const { keyPoints, keyTimes } = glideTiming(run);
  return (
    <>
      {pulseDefs(gid, dur ? d : undefined)}
      <path className="pulse-base" pathLength={1} d={d} stroke={`url(#${gid}-fade)`} />
      {dur && (
        <g className="pulse-sweep" mask={`url(#${gid}-line)`}>
          {/* Drawn tail-first so the bright head ends up on top. */}
          {[...TAIL].reverse().map(({ r, a }, k) => {
            const i = TAIL.length - 1 - k;
            return (
              <circle key={i} r={r} fill={`url(#${gid}-glow)`} opacity={a} stroke="none">
                <animateMotion
                  path={toPath(run)}
                  dur={dur}
                  begin={`${(i * DELAY).toFixed(3)}s`}
                  repeatCount="indefinite"
                  calcMode="linear"
                  keyPoints={keyPoints}
                  keyTimes={keyTimes}
                />
              </circle>
            );
          })}
        </g>
      )}
    </>
  );
};
/** `animate` is false for users who asked for reduced motion: the line stays, the glow goes. */
type PulseNode = (gid: string, animate: boolean) => React.ReactNode;
const PULSE: Record<Mood, PulseNode> = {
  ok: (gid, animate) => trace(BEAT_OK, gid, animate ? "2.8s" : undefined),
  busy: (gid, animate) => trace(BEAT_OK, gid, animate ? "1.2s" : undefined), // the same, faster
  warn: (gid, animate) => trace(BEAT_WARN, gid, animate ? "1.9s" : undefined),
  idle: (gid) => (
    <>
      {pulseDefs(gid)}
      <path className="pulse-idle" pathLength={1} d={FLAT_LINE} stroke={`url(#${gid}-fade)`} />
    </>
  ),
  // Alarm plays a 20 s story on a loop (see App.css): a heartbeat runs, stutters and drains away into
  // the flat line, and the X appears for the rest of the loop. With reduced motion only the end of it stays: the line and the X.
  alarm: (gid) => (
    <>
      {pulseDefs(
        gid,
        undefined,
        <>
          {/* The X casts a soft shadow: a blurred, doubled ellipse cut out of the dashed line, so
              the line fades out around the X instead of running into it. */}
          <filter id={`${gid}-xf`} filterUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
          <mask id={`${gid}-xm`} maskUnits="userSpaceOnUse" x="-4" y="-4" width="32" height="32">
            <rect x="-4" y="-4" width="32" height="32" fill="#fff" />
            <ellipse cx="12" cy="12" rx="8.6" ry="5.6" fill="#000" filter={`url(#${gid}-xf)`} />
            <ellipse cx="12" cy="12" rx="8.6" ry="5.6" fill="#000" filter={`url(#${gid}-xf)`} />
          </mask>
        </>,
      )}
      <path className="pulse-beat" pathLength={1} d={toPath(BEAT_OK)} stroke={`url(#${gid}-fade)`} />
      <path className="pulse-flat" d={FLAT_LINE} stroke={`url(#${gid}-fade)`} mask={`url(#${gid}-xm)`} />
      <path className="pulse-x" pathLength={1} d="M9 8l6 8M15 8l-6 8" />
    </>
  ),
  offline: wifiOff,
};

export const ORB_ICON: Record<StatusIcon, Record<Mood, PulseNode>> = {
  // Rings have no gradient, so they ignore the id.
  rings: {
    ok: () => RINGS.ok,
    busy: () => RINGS.busy,
    idle: () => RINGS.idle,
    warn: () => RINGS.warn,
    alarm: () => RINGS.alarm,
    offline: wifiOff,
  },
  pulse: PULSE,
};

/** The orb's hover refresh arrow, drawn in the orb icons' own frame and stroke so it reads as one
 *  of them: an arc the size of the middle ring that runs into an open arrowhead pointing along it. */
export function OrbRefresh() {
  return (
    <svg className="orb-refresh-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M19.39 13.3A7.5 7.5 0 1 1 17.3 6.7L18.36 7.76" />
      <path d="M18.36 4.76L18.36 7.76L15.36 7.76" />
    </svg>
  );
}

/** The orb's icon. Re-keyed per style + mood by the caller so the draw-in replays on change. */
export function OrbIcon({
  style,
  mood,
  className = "",
}: {
  style: StatusIcon;
  mood: Mood;
  className?: string;
}) {
  const gid = useId();
  const animate = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return (
    <svg
      className={`orb-icon orb-icon-${style}${mood === "offline" ? " off-wifi" : ""} ${className}`.trim()}
      data-mood={mood}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      {ORB_ICON[style][mood](gid, animate)}
    </svg>
  );
}

/** A small live sample of a style (calm mood) for the Settings picker. */
export function OrbThumb({ style }: { style: StatusIcon }) {
  return (
    <span className="orb-thumb" data-icon={style} aria-hidden="true">
      <OrbIcon style={style} mood="ok" />
    </span>
  );
}
