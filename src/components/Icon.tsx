import type { JSX } from "react";

// Inline Lucide icons (lucide.dev, ISC license). Only the handful the app uses.
// ponytail: hand-picked — copy a new icon's inner SVG from lucide.dev and add a
// case here. Keep the <svg> wrapper below so size/stroke/color stay uniform.
const ICONS: Record<string, JSX.Element> = {
  // chevron-down
  chevronDown: <path d="m6 9 6 6 6-6" />,
  // chevron-up
  chevronUp: <path d="m18 15-6-6-6 6" />,
  // ellipsis-vertical (kebab "more" menu)
  more: (
    <>
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="19" r="1" />
    </>
  ),
  // pencil (edit)
  edit: (
    <>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </>
  ),
  // x (remove / close)
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  // plus (add)
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  // menu (hamburger)
  menu: (
    <>
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="6" y2="6" />
      <line x1="4" x2="20" y1="18" y2="18" />
    </>
  ),
  // rotate-cw (refresh)
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <path d="M21 3v6h-6" />
    </>
  ),
};

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: keyof typeof ICONS;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}
