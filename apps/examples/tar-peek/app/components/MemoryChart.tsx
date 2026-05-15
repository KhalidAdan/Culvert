import { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MemEvent } from "~/lib/events";

const MB = 1024 * 1024;

interface Props {
  samples: MemEvent[];
  durationMs: number;
}

export function MemoryChart({ samples, durationMs }: Props) {
  // SSR guard — Recharts needs the DOM.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Measure container width so the chart fills available space.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [mounted]);

  const chartData = useMemo(
    () =>
      samples.map((s) => ({
        time: +(s.ms / 1000).toFixed(2),
        heapUsed: +(s.heapUsed / MB).toFixed(2),
        bytesIn: +(s.bytesIn / MB).toFixed(2),
      })),
    [samples],
  );

  if (!mounted || chartData.length < 2) {
    return (
      <div ref={wrapperRef} className="chart-empty">
        waiting for samples…
      </div>
    );
  }

  return (
    <div ref={wrapperRef} style={{ width: "100%" }}>
      <LineChart
        width={width}
        height={240}
        data={chartData}
        margin={{ top: 8, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid
          vertical={false}
          strokeDasharray="2 4"
          stroke="var(--line)"
        />
        <XAxis
          dataKey="time"
          type="number"
          domain={[0, Math.max(durationMs / 1000, 1)]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
          tickFormatter={(v: number) => `${v.toFixed(1)}s`}
        />
        <YAxis
          domain={[0, "auto"]}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
          tickFormatter={(v: number) => `${v.toFixed(0)} MB`}
          width={52}
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg-card)",
            border: "1px solid var(--line)",
            borderRadius: 4,
            color: "var(--ink)",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
          labelFormatter={(label) => `${label}s`}
          formatter={(value, name) => [
            `${value} MB`,
            name === "heapUsed" ? "Heap Used" : "Bytes Streamed",
          ]}
          itemStyle={{ color: "var(--ink)" }}
        />
        <Legend
          verticalAlign="bottom"
          iconType="plainline"
          wrapperStyle={{ fontSize: 11, color: "var(--ink-mute)" }}
          formatter={(value: string) =>
            value === "heapUsed" ? "Heap Used" : "Bytes Streamed"
          }
        />
        <Line
          dataKey="heapUsed"
          type="monotone"
          stroke="#5dd5ff"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="bytesIn"
          type="monotone"
          stroke="#f5a524"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
