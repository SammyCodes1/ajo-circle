"use client";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/format";

export function Countdown({ deadline, onElapsed }: { deadline: number; onElapsed?: () => void }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const left = deadline - now;
  useEffect(() => {
    if (left <= 0 && onElapsed) onElapsed();
    // only fire when crossing zero
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left <= 0]);
  if (left <= 0) return <span className="font-semibold text-red-700">Deadline passed</span>;
  return <span className="font-mono font-semibold tabular-nums">{formatDuration(left)}</span>;
}
