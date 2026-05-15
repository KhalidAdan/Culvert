import { useMemo } from "react";
import type { MemEvent } from "~/lib/events";

interface Props {
  samples: MemEvent[];
  baselineHeap: number | null;
  durationMs: number;
}

const MB = 1024 * 1024;

/** Round up to a "nice" axis maximum. */
function niceMax(value: number): number {
  if (value <= 0) return 4 * MB;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  for (const m of [1, 2, 5, 10]) {
    const cand = m * mag;
    if (cand >= value * 1.1) return cand;
  }
  return value * 1.5;
}

function formatBytes(n: number): string {
  if (Math.abs(n) >= MB) return (n / MB).toFixed(1) + " MB";
  if (Math.abs(n) >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}

export function MemoryChart({ samples, baselineHeap, durationMs }: Props) {
  const W = 800;
  const H = 240;
  const PAD = { top: 16, right: 16, bottom: 28, left: 56 };

  const points = useMemo(() => {
    if (baselineHeap === null) return null;
    return samples.map((s) => ({
      ms: s.ms,
      heapDelta: s.heapUsed - baselineHeap,
      bytesIn: s.bytesIn,
    }));
  }, [samples, baselineHeap]);

  if (!points || points.length < 2) {
    return <div className="chart-empty">waiting for samples…</div>;
  }

  const tMax = Math.max(durationMs, 1000);
  const yMax = niceMax(
    Math.max(
      ...points.map((p) => Math.max(p.bytesIn, Math.max(0, p.heapDelta))),
    ),
  );
  const yMin = Math.min(0, ...points.map((p) => p.heapDelta));
  const yRange = yMax - yMin;

  const x = (ms: number) =>
    PAD.left + (ms / tMax) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    H - PAD.bottom - ((v - yMin) / yRange) * (H - PAD.top - PAD.bottom);

  const buildPath = (sel: (p: { ms: number; heapDelta: number; bytesIn: number }) => number) =>
    points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${x(p.ms).toFixed(1)} ${y(sel(p)).toFixed(1)}`,
      )
      .join(" ");

  const bytesPath = buildPath((p) => p.bytesIn);
  const heapPath = buildPath((p) => p.heapDelta);

  const yTicks = [
    yMin,
    yMin + yRange / 4,
    yMin + yRange / 2,
    yMin + (3 * yRange) / 4,
    yMax,
  ].map((v) => ({ v, y: y(v) }));

  const xTickCount = 5;
  const xTicks = Array.from({ length: xTickCount + 1 }, (_, i) => {
    const ms = (tMax * i) / xTickCount;
    return { ms, x: x(ms) };
  });

  const lastPoint = points[points.length - 1];

  return (
    <svg
      className="chart-svg"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
    >
      {/* Y gridlines (the v=0 line is rendered as the axis line) */}
      {yTicks.map((t, i) => (
        <line
          key={`yg-${i}`}
          className={t.v === 0 ? "chart-axis-line" : "chart-grid-line"}
          x1={PAD.left}
          x2={W - PAD.right}
          y1={t.y}
          y2={t.y}
        />
      ))}

      {/* X gridlines */}
      {xTicks.map((t, i) => (
        <line
          key={`xg-${i}`}
          className="chart-grid-line"
          x1={t.x}
          x2={t.x}
          y1={PAD.top}
          y2={H - PAD.bottom}
        />
      ))}

      {/* Y labels */}
      {yTicks.map((t, i) => (
        <text
          key={`yl-${i}`}
          className="chart-label"
          x={PAD.left - 8}
          y={t.y + 3}
          textAnchor="end"
        >
          {formatBytes(t.v)}
        </text>
      ))}

      {/* X labels */}
      {xTicks.map((t, i) => (
        <text
          key={`xl-${i}`}
          className="chart-label"
          x={t.x}
          y={H - PAD.bottom + 16}
          textAnchor="middle"
        >
          {(t.ms / 1000).toFixed(1)}s
        </text>
      ))}

      {/* Heap delta — the "boring" hero. Stays flat. */}
      <path className="chart-line chart-line--heap" d={heapPath} />

      {/* Bytes streamed — climbs as data flows. */}
      <path className="chart-line chart-line--bytes" d={bytesPath} />

      {/* End-point dot for bytes — head of the stream */}
      <circle
        className="chart-dot chart-dot--bytes"
        cx={x(lastPoint.ms)}
        cy={y(lastPoint.bytesIn)}
        r="3"
      />

      {/* Plot border */}
      <rect
        className="chart-frame"
        x={PAD.left}
        y={PAD.top}
        width={W - PAD.left - PAD.right}
        height={H - PAD.top - PAD.bottom}
      />
    </svg>
  );
}
