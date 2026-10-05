import { useId } from "react";
import type { StatusIcon } from "../types";

/**
 * Small drawings of the menu-bar (tray) icon, for the Settings picker.
 *
 * The real icon is drawn pixel by pixel in Rust (`src-tauri/src/tray.rs`). These are the same
 * shapes in the same 24-unit box with the same numbers (`prims` / `filled_prims` there), as SVG, so
 * the picker shows what the menu bar will show. Change one, change the other.
 */

export type TrayMood = "ok" | "warn" | "alarm" | "offline" | "busy";

/** Every state a tray icon can show, in the order the picker lists them. */
export const TRAY_MOODS: { mood: TrayMood; title: string }[] = [
  { mood: "ok", title: "All clear" },
  { mood: "warn", title: "Heads up" },
  { mood: "alarm", title: "Alarm" },
  { mood: "offline", title: "Offline" },
  { mood: "busy", title: "Checking" },
];

// The in-app orb's colours: the menu bar shows what the orb shows.
const MOOD_COLOR: Record<TrayMood, string> = {
  ok: "var(--mood-ok)",
  warn: "var(--mood-warn)",
  alarm: "var(--mood-alarm)",
  offline: "var(--mood-offline)",
  busy: "var(--mood-busy)",
};

type Pt = readonly [number, number];
type Dash = readonly [number, number];
type Shape =
  // `round`: the dashes have round ends, so short ones read as dots.
  | { t: "ring"; r: number; w: number; a: number; dash?: Dash; round?: boolean }
  | { t: "line"; pts: readonly Pt[]; w: number; a: number; k: number }
  | { t: "dot"; x: number; y: number; r: number; a?: number }
  | { t: "frame" }
  // Offline: a Wi-Fi whose first dot is the dot of a "!". Final stroke widths, drawn at scale `k`.
  | { t: "wifi"; k: number; arcW: number; barW: number; dotR: number; gapR: number };

const C = 12; // the box centre
const RING_W = 1.9;
const PULSE_W = 1.9;
const PULSE_FIT = 0.7;
const FRAME_HALF = 10.4;
const FRAME_CORNER = 4.0;
const PLATE_HALF = 11.0;
const PLATE_CORNER = 4.8; // Pulse's rounded square; Rings' plate is a circle (corner = half)
const FILLED_RING_W = 1.7;

const BEAT_OK: Pt[] = [[2, 12], [6, 12], [9, 3], [15, 21], [18, 12], [22, 12]];
const BEAT_WARN: Pt[] = [[2, 12], [10, 12], [12, 8], [15, 16], [17, 12], [22, 12]];
const CROSS_A: Pt[] = [[9, 8], [15, 16]];
const CROSS_B: Pt[] = [[15, 8], [9, 16]];
const BANG: Pt[] = [[12, 9], [12, 12.6]];

// The Wi-Fi's geometry in the 24-unit box before it is shrunk (`wifi_off` in tray.rs): three solid
// 90° arcs over one focal point, the focal dot, and the "!"'s bar above them. The bar casts a gap
// (round-ended, as wide as `gapR * 2`) out of the arcs.
const WIFI_FOCUS: Pt = [12, 18.6];
const WIFI_ARCS: { r: number; a: number }[] = [
  { r: 4.6, a: 1 },
  { r: 9.1, a: 0.85 },
  { r: 13.6, a: 0.7 },
];
const WIFI_BAR: Pt[] = [[12, 4.9], [12, 12.9]];
const WIFI_BARE = { k: 0.74, arcW: 1.6, barW: 1.7, dotR: 1.1, gapR: 2.45 }; // in Pulse's frame, or beside Rings' ring
const WIFI_FILLED = { k: 0.72, arcW: 1.7, barW: 2.0, dotR: 1.1, gapR: 2.6 }; // cut out of the plate

/** The shapes on the bare menu bar. */
function bare(glyph: StatusIcon, mood: TrayMood): Shape[] {
  const ring = (r: number, a: number, dash?: Dash): Shape => ({
    t: "ring", r, w: RING_W, a, dash, round: dash !== undefined,
  });
  if (mood === "offline") {
    const wifi: Shape = { t: "wifi", ...WIFI_BARE };
    return glyph === "pulse" ? [{ t: "frame" }, wifi] : [ring(10.6, 0.9), wifi];
  }
  if (glyph === "rings") {
    if (mood === "ok" || mood === "busy") {
      return [ring(3.2, 1), ring(6.8, 0.9), ring(10.6, 0.8)];
    }
    // Dotted rings: the dash is shorter than the stroke is wide, so each is a round dot.
    if (mood === "warn") {
      return [
        ring(6.8, 1),
        ring(10.6, 0.85, [1.1, 4.02]),
        { t: "line", pts: BANG, w: 2.0, a: 1, k: 1 },
        { t: "dot", x: 12, y: 15.6, r: 1.2 },
      ];
    }
    return [ring(3.2, 1, [0.5, 3.52]), ring(6.8, 0.95, [0.8, 3.47]), ring(10.6, 0.85, [1.1, 3.66])];
  }
  const line = (pts: Pt[], a: number, k: number): Shape => ({ t: "line", pts, w: PULSE_W, a, k });
  const frame: Shape = { t: "frame" };
  if (mood === "ok" || mood === "busy") return [frame, line(BEAT_OK, 1, PULSE_FIT)];
  if (mood === "warn") return [frame, line(BEAT_WARN, 1, PULSE_FIT)];
  // Alarm: a dead line, as two dots each side of the X, which sits between them.
  return [
    frame,
    ...[4.7, 6.8, 17.2, 19.3].map((x): Shape => ({ t: "dot", x, y: 12, r: 0.95, a: 0.85 })),
    line(CROSS_A, 1, 0.95),
    line(CROSS_B, 1, 0.95),
  ];
}

/** The shapes cut out of the filled plate. */
function cutOut(glyph: StatusIcon, mood: TrayMood): Shape[] {
  const ring = (r: number, a: number, dash?: Dash): Shape => ({
    t: "ring", r, w: FILLED_RING_W, a, dash, round: dash !== undefined,
  });
  const line = (pts: Pt[], w: number, a: number, k: number): Shape => ({ t: "line", pts, w, a, k });
  if (mood === "offline") return [{ t: "wifi", ...WIFI_FILLED }];
  if (glyph === "rings") {
    if (mood === "ok" || mood === "busy") return [ring(2.3, 1), ring(5.0, 0.85), ring(7.7, 0.65)];
    if (mood === "warn") {
      return [
        ring(5.0, 0.9),
        ring(7.7, 0.65, [0.8, 3.23]),
        line(BANG, 1.7, 1, 0.72),
        { t: "dot", x: 12, y: 14.6, r: 1.0 },
      ];
    }
    return [ring(3.0, 1, [0.5, 3.27]), ring(6.4, 0.8, [0.5, 3.521])]; // the bare alarm, outer ring dropped
  }
  if (mood === "ok" || mood === "busy") return [line(BEAT_OK, PULSE_W, 1, 0.78)];
  if (mood === "warn") return [line(BEAT_WARN, PULSE_W, 1, 0.78)];
  return [
    ...[4, 6.4, 17.6, 20].map((x): Shape => ({ t: "dot", x, y: 12, r: 0.95, a: 0.85 })),
    line(CROSS_A, PULSE_W, 1, 0.95),
    line(CROSS_B, PULSE_W, 1, 0.95),
  ];
}

const fit = (pts: readonly Pt[], k: number) =>
  pts.map(([x, y]) => `${C + (x - C) * k},${C + (y - C) * k}`).join(" ");

const barPath = `M${WIFI_BAR[0][0]} ${WIFI_BAR[0][1]}V${WIFI_BAR[1][1]}`;

/**
 * The Wi-Fi with its "!". It is drawn at scale `k` about the box centre, so every width is the final
 * one divided by `k`. Bare: a mask (`cutId`) cuts the bar's gap out of the arcs. Filled (`restore`
 * is the plate colour): the glyph is already inside the plate's mask, so the gap is painted back.
 */
function drawWifi(s: Extract<Shape, { t: "wifi" }>, ink: string, restore: string | null, cutId: string) {
  const { k } = s;
  const [fx, fy] = WIFI_FOCUS;
  const arcs = WIFI_ARCS.map(({ r, a }) => {
    const d = r * Math.SQRT1_2;
    return (
      <path
        key={r}
        d={`M${fx - d} ${fy - d}A${r} ${r} 0 0 1 ${fx + d} ${fy - d}`}
        fill="none" stroke={ink} strokeWidth={s.arcW / k} strokeLinecap="round" opacity={a}
      />
    );
  });
  const gap = (stroke: string) => (
    <path d={barPath} fill="none" stroke={stroke} strokeWidth={(2 * s.gapR) / k} strokeLinecap="round" />
  );
  const dot = <circle cx={fx} cy={fy} r={s.dotR / k} fill={ink} />;
  const bar = <path d={barPath} fill="none" stroke={ink} strokeWidth={s.barW / k} strokeLinecap="round" />;
  const scale = `translate(${C} ${C}) scale(${k}) translate(${-C} ${-C})`;
  if (restore) {
    return (
      <g key="wifi" transform={scale}>
        {arcs}
        {gap(restore)}
        {dot}
        {bar}
      </g>
    );
  }
  return (
    <g key="wifi">
      <mask id={cutId}>
        <rect x={-2} y={-2} width={28} height={28} fill="#fff" />
        {gap("#000")}
      </mask>
      <g transform={scale}>
        <g mask={`url(#${cutId})`}>{arcs}</g>
        {dot}
        {bar}
      </g>
    </g>
  );
}

function drawShape(s: Shape, i: number, ink: string, restore: string | null, cutId: string) {
  switch (s.t) {
    case "ring":
      return (
        <circle
          key={i}
          cx={C} cy={C} r={s.r}
          fill="none" stroke={ink} strokeWidth={s.w} opacity={s.a}
          strokeLinecap={s.round ? "round" : undefined}
          strokeDasharray={s.dash?.join(" ")}
        />
      );
    case "line":
      return (
        <polyline
          key={i}
          points={fit(s.pts, s.k)}
          fill="none" stroke={ink} strokeWidth={s.w} opacity={s.a}
          strokeLinejoin="round" strokeLinecap="round"
        />
      );
    case "dot":
      return <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={ink} opacity={s.a} />;
    case "wifi":
      return drawWifi(s, ink, restore, cutId);
    case "frame":
      return (
        <rect
          key={i}
          x={C - FRAME_HALF} y={C - FRAME_HALF}
          width={FRAME_HALF * 2} height={FRAME_HALF * 2}
          rx={FRAME_CORNER}
          fill="none" stroke={ink} strokeWidth={RING_W} opacity={0.9}
        />
      );
  }
}

/** One menu-bar icon in one state, bare or cut out of a filled plate. Decorative — the caller labels it. */
export function TrayIcon({
  icon,
  filled,
  mood,
  size = 20,
}: {
  icon: StatusIcon;
  filled: boolean;
  mood: TrayMood;
  size?: number;
}) {
  const maskId = useId();
  const cutId = useId();
  const plateCorner = icon === "rings" ? PLATE_HALF : PLATE_CORNER;
  return (
    <svg
      className="tray-icon"
      data-icon={icon}
      data-filled={filled}
      data-mood={mood}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ color: MOOD_COLOR[mood] }}
    >
      {filled ? (
        <>
          {/* The glyph is a hole in the plate: black strokes on a white mask. */}
          <mask id={maskId}>
            <rect
              x={C - PLATE_HALF} y={C - PLATE_HALF}
              width={PLATE_HALF * 2} height={PLATE_HALF * 2}
              rx={plateCorner} fill="#fff"
            />
            {cutOut(icon, mood).map((s, i) => drawShape(s, i, "#000", "#fff", cutId))}
          </mask>
          <rect
            x={C - PLATE_HALF} y={C - PLATE_HALF}
            width={PLATE_HALF * 2} height={PLATE_HALF * 2}
            rx={plateCorner} fill="currentColor" mask={`url(#${maskId})`}
          />
        </>
      ) : (
        bare(icon, mood).map((s, i) => drawShape(s, i, "currentColor", null, cutId))
      )}
    </svg>
  );
}
