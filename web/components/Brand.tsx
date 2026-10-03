import { useId } from "react";

/** Ajo Circle mark: a dotted ring of members with the current recipient in clay. */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#1F1E1D" />
      <circle
        cx="32"
        cy="32"
        r="17"
        fill="none"
        stroke="#F5F1EA"
        strokeWidth="3"
        strokeDasharray="3 5.9"
        strokeLinecap="round"
      />
      <circle cx="32" cy="15" r="5.5" fill="#D97757" />
      <circle cx="46.7" cy="40.5" r="3.4" fill="#F5F1EA" />
      <circle cx="17.3" cy="40.5" r="3.4" fill="#F5F1EA" />
    </svg>
  );
}

/**
 * Low-contrast pattern inspired by adire eleko (Yoruba resist-dyed indigo
 * cloth): concentric "olokun" circles, dotted grids and tied-thread crosses.
 */
export function AdirePattern({
  className = "",
  color = "#2F3B5C",
  opacity = 0.09,
}: {
  className?: string;
  color?: string;
  opacity?: number;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <svg aria-hidden className={`pointer-events-none ${className}`} width="100%" height="100%">
      <defs>
        <pattern id={`adire-${id}`} width="72" height="72" patternUnits="userSpaceOnUse">
          <g fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round">
            {/* olokun circles */}
            <circle cx="18" cy="18" r="11" />
            <circle cx="18" cy="18" r="6" />
            <circle cx="18" cy="18" r="1.6" fill={color} />
            {/* tied-thread cross */}
            <path d="M48 10 l12 12 M60 10 l-12 12" />
            <path d="M54 6 v4 M54 26 v4 M44 16 h4 M60 16 h4" />
            {/* wavy stitch line */}
            <path d="M4 48 q6 -6 12 0 t12 0 t12 0" />
            {/* concentric half-moon */}
            <path d="M46 64 a10 10 0 0 1 20 0 M50 64 a6 6 0 0 1 12 0" />
          </g>
          <g fill={color}>
            {[0, 1, 2].map((r) =>
              [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={6 + c * 6} cy={58 + r * 6} r="1.1" />),
            )}
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#adire-${id})`} opacity={opacity} />
    </svg>
  );
}
