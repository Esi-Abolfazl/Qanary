// Qanary brandmark — a canary whose eye is the live status light.
// Themeable fills read CSS variables defined on the parent (see App.css
// .logo-mark), so the bird is yellow-on-dark / charcoal-on-light via
// light-dark(). The eye uses `currentColor`, set by the parent element.

export function Canary({ size = 32 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 120 116"
      width={size}
      height={(size * 116) / 120}
      style={{ overflow: "visible", display: "block" }}
      aria-hidden="true"
    >
      {/* tail */}
      <path d="M40,66 L6,52 L20,82 Z" fill="var(--mark-body)" />
      {/* crest */}
      <path d="M66,30 Q70,12 79,16 Q74,24 80,28 Z" fill="var(--mark-body)" />
      <path d="M78,26 Q86,11 94,18 Q86,24 90,30 Z" fill="var(--mark-body)" />
      {/* body + head */}
      <ellipse cx="54" cy="70" rx="31" ry="28" fill="var(--mark-body)" />
      <circle cx="83" cy="43" r="20" fill="var(--mark-body)" />
      {/* wing */}
      <path
        d="M48,58 C66,57 78,70 77,90 C63,95 44,87 40,70 Z"
        fill="var(--mark-wing)"
        opacity="0.11"
      />
      {/* beak (constant brand color) */}
      <path d="M100,39 L118,44 L100,50 Z" fill="#f2792b" />
      {/* eye = status light, color set via currentColor on parent */}
      <circle cx="86" cy="41" r="6.4" fill="var(--mark-eye-bg)" />
      <circle cx="86" cy="41" r="3.8" fill="currentColor" />
    </svg>
  );
}
