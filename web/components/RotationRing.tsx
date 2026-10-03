"use client";

export interface RingMember {
  address: string;
  /** Contributed in the current round. */
  paid?: boolean;
  /** Has missed at least one round. */
  defaulted?: boolean;
  /** Already received their pot in a past round. */
  received?: boolean;
}

const C = 200; // centre in viewBox units
const R = 128; // ring radius

function polar(angleDeg: number, r: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: C + r * Math.cos(a), y: C + r * Math.sin(a) };
}

function shortAddr(a: string) {
  return a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-3)}` : a;
}

/**
 * The circle as a circle: members sit around a ring in payout order, starting at
 * 12 o'clock and rotating clockwise. The clay arc traces how far the pot has
 * travelled; the current recipient is highlighted.
 */
export function RotationRing({
  members,
  current,
  me,
  showLabels = true,
  children,
  className = "",
  title = "Payout rotation",
}: {
  members: RingMember[];
  /** Index of this round's recipient, or -1 when the circle is complete. */
  current: number;
  me?: string | null;
  showLabels?: boolean;
  children?: React.ReactNode;
  className?: string;
  title?: string;
}) {
  const n = Math.max(members.length, 1);
  const step = 360 / n;
  const angleOf = (i: number) => -90 + i * step;
  const nodeR = Math.max(5, Math.min(19, ((2 * Math.PI * R) / n) * 0.3));
  const labels = showLabels && n <= 12;
  const done = current < 0;
  // progress arc from the first member to the current recipient
  const arcEnd = done ? 359.99 : current * step;
  const large = arcEnd > 180 ? 1 : 0;
  const start = polar(-90, R);
  const end = polar(-90 + arcEnd, R);
  const arcPath =
    arcEnd > 0 ? `M ${start.x} ${start.y} A ${R} ${R} 0 ${large} 1 ${end.x} ${end.y}` : "";

  return (
    <div className={`relative mx-auto w-full ${labels ? "aspect-[540/460]" : "aspect-square"} ${className}`}>
      <svg
        viewBox={labels ? "-70 -30 540 460" : "28 28 344 344"}
        className="absolute inset-0 h-full w-full overflow-visible"
        role="img"
        aria-label={`${title}: ${n} members${done ? ", all rounds complete" : `, member ${current + 1} receives this round`}`}
      >
        {/* tick marks */}
        {Array.from({ length: 72 }, (_, i) => {
          const a = polar(i * 5, R + 26);
          const b = polar(i * 5, R + (i % 6 === 0 ? 33 : 29));
          return (
            <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#CFC4B2" strokeWidth={i % 6 === 0 ? 1.2 : 0.8} />
          );
        })}
        {/* base ring */}
        <circle cx={C} cy={C} r={R} fill="none" stroke="#E2DACC" strokeWidth="1.5" />
        <circle cx={C} cy={C} r={R - 34} fill="none" stroke="#E2DACC" strokeWidth="1" strokeDasharray="2 6" />
        {/* travelled arc */}
        {arcPath && (
          <path
            d={arcPath}
            fill="none"
            stroke={done ? "#4F6B4A" : "#D97757"}
            strokeWidth="3"
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}
        {/* direction chevron just ahead of the current recipient */}
        {!done && n > 1 && (() => {
          const a = angleOf(current) + Math.min(step * 0.5, 22);
          const p = polar(a, R);
          return (
            <g transform={`translate(${p.x} ${p.y}) rotate(${a + 90})`}>
              <path d="M -5 -4 L 1 0 L -5 4" fill="none" stroke="#C96442" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })()}

        {members.map((m, i) => {
          const a = angleOf(i);
          const p = polar(a, R);
          const isCurrent = i === current;
          const isMe = !!me && m.address === me;
          const fill = isCurrent ? "#C96442" : m.received ? "#1F1E1D" : "#FAF9F5";
          const stroke = isCurrent ? "#C96442" : m.received ? "#1F1E1D" : m.paid ? "#4F6B4A" : "#CFC4B2";
          const text = isCurrent || m.received ? "#FAF9F5" : "#1F1E1D";
          const lp = polar(a, R + 52);
          const cos = Math.cos((a * Math.PI) / 180);
          const anchor = Math.abs(cos) < 0.3 ? "middle" : cos > 0 ? "start" : "end";
          return (
            <g key={m.address + i}>
              {isCurrent && (
                <>
                  <circle cx={p.x} cy={p.y} r={nodeR + 9} fill="#D97757" opacity="0.14" />
                  <circle cx={p.x} cy={p.y} r={nodeR + 5} fill="none" stroke="#D97757" strokeWidth="1" opacity="0.6" />
                </>
              )}
              <circle cx={p.x} cy={p.y} r={nodeR} fill={fill} stroke={stroke} strokeWidth={m.paid && !isCurrent && !m.received ? 2.2 : 1.4} />
              {nodeR >= 9 && (
                <text
                  x={p.x}
                  y={p.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={text}
                  style={{ font: `500 ${Math.round(nodeR * 0.78)}px var(--font-serif)` }}
                >
                  {i + 1}
                </text>
              )}
              {m.paid && (
                <g transform={`translate(${p.x + nodeR * 0.72} ${p.y - nodeR * 0.72})`}>
                  <circle r={Math.max(4, nodeR * 0.42)} fill="#4F6B4A" stroke="#FAF9F5" strokeWidth="1.5" />
                  <path
                    d={`M ${-nodeR * 0.18} 0 L ${-nodeR * 0.04} ${nodeR * 0.14} L ${nodeR * 0.2} ${-nodeR * 0.14}`}
                    fill="none"
                    stroke="#FAF9F5"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              )}
              {m.defaulted && (
                <g transform={`translate(${p.x - nodeR * 0.72} ${p.y - nodeR * 0.72})`}>
                  <circle r={Math.max(4, nodeR * 0.38)} fill="#9E3F2C" stroke="#FAF9F5" strokeWidth="1.5" />
                  <path d={`M 0 ${-nodeR * 0.16} V ${nodeR * 0.04}`} stroke="#FAF9F5" strokeWidth="1.6" strokeLinecap="round" />
                  <circle cx="0" cy={nodeR * 0.17} r="0.9" fill="#FAF9F5" />
                </g>
              )}
              {labels && (
                <text
                  x={lp.x}
                  y={lp.y}
                  textAnchor={anchor}
                  dominantBaseline="central"
                  fill={isCurrent ? "#9A4325" : "#6B6560"}
                  style={{ font: `${isCurrent || isMe ? 600 : 400} 16px var(--font-mono)` }}
                >
                  {isMe ? "you" : shortAddr(m.address)}
                </text>
              )}
              <title>{`#${i + 1} ${m.address}${isCurrent ? " · receiving this round" : ""}${m.paid ? " · paid" : ""}${m.defaulted ? " · has defaulted" : ""}${m.received ? " · already received" : ""}`}</title>
            </g>
          );
        })}
      </svg>
      {children && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="pointer-events-auto max-w-[44%] text-center">{children}</div>
        </div>
      )}
    </div>
  );
}

export function RingLegend({ className = "" }: { className?: string }) {
  const item = (swatch: React.ReactNode, label: string) => (
    <li className="flex items-center gap-2">
      {swatch}
      <span>{label}</span>
    </li>
  );
  return (
    <ul className={`flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted ${className}`}>
      {item(<span className="h-3 w-3 rounded-full bg-clay" />, "Receiving now")}
      {item(<span className="h-3 w-3 rounded-full border-2 border-sage bg-ivory" />, "Paid this round")}
      {item(<span className="h-3 w-3 rounded-full bg-ink" />, "Already received")}
      {item(<span className="h-3 w-3 rounded-full bg-rust" />, "Has defaulted")}
    </ul>
  );
}
