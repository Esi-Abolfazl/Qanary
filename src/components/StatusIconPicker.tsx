import { useEffect, useId, useRef, useState } from "react";
import type { StatusIcon, TrayShape } from "../types";
import { OrbIcon, OrbThumb, ORB_STYLE_LABEL } from "./orbIcons";
import { Switch } from "./Switch";
import { TrayIcon, TRAY_MOODS } from "./trayIcons";

/** The menu bar's pictures, in the order the dropdown lists them. `same` follows the status icon.
 *  Whether the picture is cut out of a filled square is a separate switch under the dropdown. */
type Choice = { shape: TrayShape; title: string; hint?: string };
const CHOICES: Choice[] = [
  { shape: "same", title: "Same as app", hint: "Follows the Status icon above" },
  { shape: "pulse", title: "Pulse" },
  { shape: "rings", title: "Rings" },
];
const STYLES: StatusIcon[] = ["pulse", "rings"];

/** The picture a menu-bar shape draws, given the app's status icon. */
const pictureOf = (shape: TrayShape, statusIcon: StatusIcon): StatusIcon =>
  shape === "same" ? statusIcon : shape;

/** The five states, as small orbs, for the "?" popover. */
const ORB_MOODS = [
  { mood: "ok", title: "All clear" },
  { mood: "warn", title: "Heads up" },
  { mood: "alarm", title: "Alarm" },
  { mood: "offline", title: "Offline" },
  { mood: "busy", title: "Checking" },
] as const;

/** Five icons of one look, one per state. */
function Strip({ icon, filled, size }: { icon: StatusIcon; filled: boolean; size: number }) {
  return (
    <span className="tray-strip">
      {TRAY_MOODS.map(({ mood }) => (
        <TrayIcon key={mood} icon={icon} filled={filled} mood={mood} size={size} />
      ))}
    </span>
  );
}

/**
 * Settings → Appearance: the status icon (the in-app orb), a "?" that shows what each state looks
 * like, and the menu-bar icon: a dropdown for its picture ("Same as app" follows the orb, or Pulse /
 * Rings whatever the orb shows) and a "Filled" switch for the filled-square look (ADR-0049).
 */
export function StatusIconPicker({
  statusIcon,
  onStatusIcon,
  trayShape,
  trayFilled,
  onTray,
}: {
  statusIcon: StatusIcon;
  onStatusIcon: (icon: StatusIcon) => void;
  trayShape: TrayShape;
  trayFilled: boolean;
  onTray: (shape: TrayShape, filled: boolean) => void;
}) {
  const uid = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Close either popup on a click outside it or on Escape.
  useEffect(() => {
    if (!helpOpen && !menuOpen) return;
    const away = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setHelpOpen(false);
        setMenuOpen(false);
      }
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // The menu is a popup inside the Settings dialog: Escape closes it, not the dialog.
      e.stopPropagation();
      if (menuOpen) triggerRef.current?.focus();
      setHelpOpen(false);
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc, true);
    };
  }, [helpOpen, menuOpen]);

  const effective = pictureOf(trayShape, statusIcon);
  const selected = CHOICES.find((c) => c.shape === trayShape) ?? CHOICES[0];

  return (
    <div ref={rootRef} className="icon-pick">
      <div className="icon-pick-row icon-pick-anchor">
        <span className="icon-pick-label">
          <span id={`${uid}-icon`}>Status icon</span>
          <button
            type="button"
            className="icon-help"
            aria-expanded={helpOpen}
            aria-label="What do the icons mean?"
            title="What do the icons mean?"
            onClick={() => {
              setMenuOpen(false);
              setHelpOpen((o) => !o);
            }}
          >
            ?
          </button>
        </span>
        <div className="seg" role="radiogroup" aria-labelledby={`${uid}-icon`}>
          {STYLES.map((icon) => (
            <button
              key={icon}
              type="button"
              role="radio"
              aria-checked={statusIcon === icon}
              className="seg-opt"
              onClick={() => onStatusIcon(icon)}
            >
              <OrbThumb style={icon} />
              <span>{ORB_STYLE_LABEL[icon]}</span>
            </button>
          ))}
        </div>
        {helpOpen && (
          <div className="icon-popover" role="dialog" aria-label="What each state looks like">
            <div className="icon-popover-title">{ORB_STYLE_LABEL[statusIcon]} — what each state looks like</div>
            <div className="icon-states">
              {ORB_MOODS.map(({ mood, title }) => (
                <div key={mood} className="icon-state">
                  <span className={`orb-mini orb-mini-${mood}`} data-icon={statusIcon}>
                    <OrbIcon style={statusIcon} mood={mood} />
                  </span>
                  {title}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="icon-pick-row">
        <span className="icon-pick-label" id={`${uid}-tray`}>
          Menu bar
        </span>
        <div className="tray-dd-wrap">
          <button
            ref={triggerRef}
            type="button"
            className="tray-dd"
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            aria-labelledby={`${uid}-tray`}
            aria-describedby={`${uid}-cur`}
            onClick={() => {
              setHelpOpen(false);
              setMenuOpen((o) => !o);
            }}
          >
            <Strip icon={effective} filled={trayFilled} size={20} />
          </button>
          <span id={`${uid}-cur`} className="sr-only">
            {selected.title}
          </span>
          {menuOpen && (
            <div className="tray-menu" role="listbox" aria-labelledby={`${uid}-tray`}>
              {CHOICES.map((c) => (
                <button
                  key={c.shape}
                  type="button"
                  role="option"
                  aria-selected={c.shape === trayShape}
                  className="tray-opt"
                  title={c.hint}
                  onClick={() => {
                    onTray(c.shape, trayFilled);
                    setMenuOpen(false);
                    triggerRef.current?.focus();
                  }}
                >
                  <b>{c.title}</b>
                  <Strip icon={pictureOf(c.shape, statusIcon)} filled={trayFilled} size={16} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="icon-pick-row">
        <label className="icon-pick-label" htmlFor={`${uid}-fill`}>
          Filled menubar icons
        </label>
        <Switch id={`${uid}-fill`} checked={trayFilled} onChange={(filled) => onTray(trayShape, filled)} />
      </div>
      <p className="icon-pick-hint">
        {trayShape === "same"
          ? "The menu bar uses the same icon as the app."
          : "The menu bar and the app use different icons."}
      </p>
    </div>
  );
}
