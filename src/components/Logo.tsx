/* Single AidFlow shield logo, used everywhere (hero, header, footer, control-room sidebar). */
export default function Logo({ className, size }: { className?: string; size?: number }) {
  return (
    <svg
      className={className}
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path
        d="M16 2 L28 8 V17 C28 24 22 28.5 16 30 C10 28.5 4 24 4 17 V8 Z"
        fill="none"
        stroke="#38bdf8"
        strokeWidth="1.4"
      />
      <path
        d="M9 17 H13 L15 12 L18 21 L20 17 H23"
        stroke="#ff4545"
        strokeWidth="1.6"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
