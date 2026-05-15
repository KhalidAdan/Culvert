import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { useLoaderData } from "react-router";
import { MemoryChart } from "~/components/MemoryChart";
import type {
  DoneEvent,
  EntryEvent,
  MemEvent,
  PeekEvent,
  StartEvent,
} from "~/lib/events";
import { readNdjson } from "~/lib/ndjson";
import type { Route } from "./+types/_index";

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const packageName = url.searchParams.get("package") || "next";
  return { packageName };
}

export function meta(_: Route.MetaArgs) {
  return [
    { title: "culvert · tarball peeker" },
    {
      name: "description",
      content:
        "Live npm tarball peeker built on @culvert/tar. Constant memory, served from the wire.",
    },
  ];
}

/* ---------------- State ---------------- */

interface State {
  status: "idle" | "streaming" | "done" | "error";
  meta: StartEvent | null;
  entries: EntryEvent[];
  samples: MemEvent[];
  summary: DoneEvent | null;
  error: string | null;
  baselineHeap: number | null;
  durationMs: number;
  bytesIn: number;
  heapUsed: number;
}

const initialState: State = {
  status: "idle",
  meta: null,
  entries: [],
  samples: [],
  summary: null,
  error: null,
  baselineHeap: null,
  durationMs: 0,
  bytesIn: 0,
  heapUsed: 0,
};

type Action =
  | { type: "reset" }
  | { type: "events"; events: PeekEvent[] }
  | { type: "fail"; message: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "reset":
      return { ...initialState, status: "streaming" };

    case "fail":
      return { ...state, status: "error", error: action.message };

    case "events": {
      // Single pass over a frame's worth of events. We mutate working
      // copies of the relevant arrays so React only re-renders once per
      // animation frame regardless of how many events arrived.
      let {
        meta,
        entries,
        samples,
        summary,
        baselineHeap,
        durationMs,
        bytesIn,
        heapUsed,
        status,
      } = state;
      let entriesChanged = false;
      let samplesChanged = false;

      for (const ev of action.events) {
        switch (ev.t) {
          case "start":
            meta = ev;
            break;
          case "entry":
            if (!entriesChanged) {
              entries = entries.slice();
              entriesChanged = true;
            }
            entries.push(ev);
            break;
          case "mem":
            if (!samplesChanged) {
              samples = samples.slice();
              samplesChanged = true;
            }
            samples.push(ev);
            if (baselineHeap === null) baselineHeap = ev.heapUsed;
            durationMs = ev.ms;
            bytesIn = ev.bytesIn;
            heapUsed = ev.heapUsed;
            break;
          case "done":
            summary = ev;
            durationMs = ev.ms;
            status = "done";
            break;
          case "error":
            return { ...state, status: "error", error: ev.message };
        }
      }

      return {
        ...state,
        meta,
        entries,
        samples,
        summary,
        baselineHeap,
        durationMs,
        bytesIn,
        heapUsed,
        status,
      };
    }
  }
}

/* ---------------- Helpers ---------------- */

const MB = 1024 * 1024;

function formatBytes(n: number, fractionDigits = 2): string {
  if (n >= MB) return (n / MB).toFixed(fractionDigits) + "";
  if (n >= 1024) return (n / 1024).toFixed(0) + "";
  return n.toString();
}

function bytesUnit(n: number): string {
  if (n >= MB) return "MB";
  if (n >= 1024) return "KB";
  return "B";
}

function throughput(bytes: number, ms: number): string {
  if (ms <= 0) return "0.0";
  const mbPerSec = bytes / MB / (ms / 1000);
  return mbPerSec.toFixed(1);
}

function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/");
  if (i === -1 || i === path.length - 1) return { dir: "", name: path };
  return { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/* ---------------- Page ---------------- */

export default function Index() {
  const { packageName } = useLoaderData<typeof loader>();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [runId, setRunId] = useState(0);

  // Frame-batched event queue. Many events per second arrive; we flush
  // them all in one rAF callback instead of one setState per event.
  const pendingRef = useRef<PeekEvent[]>([]);
  const rafRef = useRef<number | null>(null);

  const flush = useCallback(() => {
    rafRef.current = null;
    if (pendingRef.current.length === 0) return;
    const events = pendingRef.current;
    pendingRef.current = [];
    dispatch({ type: "events", events });
  }, []);

  const enqueue = useCallback(
    (event: PeekEvent) => {
      pendingRef.current.push(event);
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  // Run effect — fires on mount and on every re-run.
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;
    dispatch({ type: "reset" });

    (async () => {
      try {
        const res = await fetch(
          `/api/peek?package=${encodeURIComponent(packageName)}`,
          { signal: ac.signal },
        );
        if (!res.ok || !res.body) {
          throw new Error(`server returned ${res.status}`);
        }
        for await (const event of readNdjson(res.body, ac.signal)) {
          if (cancelled) break;
          enqueue(event);
        }
      } catch (err) {
        if (cancelled || ac.signal.aborted) return;
        dispatch({
          type: "fail",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      pendingRef.current = [];
    };
  }, [runId, enqueue, packageName]);

  // Auto-scroll the log to the bottom unless the user has scrolled up.
  const logRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);

  const onLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickyRef.current = distanceFromBottom < 24;
  }, []);

  useLayoutEffect(() => {
    if (!stickyRef.current) return;
    const el = logRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [state.entries.length]);

  const heapDelta =
    state.baselineHeap === null ? 0 : state.heapUsed - state.baselineHeap;

  return (
    <main className="app">
      <header className="header">
        <div className="brand">
          <div className="brand-mark">
            culvert<span className="dot">·</span>peeker
          </div>
          <div className="brand-tag">streaming tarball inspector</div>
        </div>
        <div className="spacer" />
        <div className="status" data-status={state.status}>
          <span className="pulse" />
          <span>{state.status}</span>
        </div>
        <button
          className="btn"
          onClick={() => setRunId((n) => n + 1)}
          disabled={state.status === "streaming"}
        >
          {state.status === "done" || state.status === "error"
            ? "run again"
            : "running…"}
        </button>
      </header>

      <div className="subhead">
        <span>package</span>
        <span className="pkg">{state.meta?.package ?? packageName}</span>
        <span className="ver">
          {state.meta ? `v${state.meta.version}` : "resolving…"}
        </span>
        <span className="url" title={state.meta?.tarballUrl}>
          {state.meta?.tarballUrl ?? ""}
        </span>
      </div>

      <div className="stats">
        <div className="stat" data-series="heap">
          <div className="stat-label">heap used</div>
          <div className="stat-value">
            <span>{formatBytes(state.heapUsed)}</span>
            <span className="unit">{bytesUnit(state.heapUsed)}</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">heap delta</div>
          <div className="stat-value">
            <span>
              {heapDelta >= 0 ? "+" : "−"}
              {formatBytes(Math.abs(heapDelta))}
            </span>
            <span className="unit">{bytesUnit(Math.abs(heapDelta))}</span>
          </div>
        </div>
        <div className="stat" data-series="bytes">
          <div className="stat-label">bytes streamed</div>
          <div className="stat-value">
            <span>{formatBytes(state.bytesIn)}</span>
            <span className="unit">{bytesUnit(state.bytesIn)}</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">throughput</div>
          <div className="stat-value">
            <span>{throughput(state.bytesIn, state.durationMs)}</span>
            <span className="unit">MB/s</span>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">entries</div>
          <div className="stat-value">
            <span>{state.entries.length.toLocaleString()}</span>
          </div>
        </div>
      </div>

      <section className="chart-panel">
        <div className="chart-head">
          <div className="chart-title">memory · throughput</div>
          <div className="chart-sub">
            heap sampled every 100ms · bytes counted via <code>tap()</code>
          </div>
        </div>
        <MemoryChart samples={state.samples} durationMs={state.durationMs} />
      </section>

      {state.error && (
        <div className="error-banner">
          <strong>error.</strong> {state.error}
        </div>
      )}

      <section className="log-panel">
        <div className="log-head">
          <div className="log-title">archive entries</div>
          <div className="log-count">
            {state.entries.length.toLocaleString()} streamed
            {state.summary &&
              ` · ${formatBytes(state.summary.totalBytes)} ${bytesUnit(state.summary.totalBytes)} total`}
          </div>
        </div>
        <div className="log" ref={logRef} onScroll={onLogScroll}>
          {state.entries.map((e, i) => {
            const { dir, name } = splitPath(e.path);
            return (
              <div className="log-row" key={i}>
                <span className="log-kind" data-kind={e.kind}>
                  {e.kind === "directory"
                    ? "dir"
                    : e.kind === "file"
                      ? "f"
                      : e.kind.slice(0, 3)}
                </span>
                <span className="log-size">
                  {e.kind === "file"
                    ? `${formatBytes(e.size, 1)} ${bytesUnit(e.size)}`
                    : ""}
                </span>
                <span className="log-path">
                  <span className="seg">{dir}</span>
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <footer className="footer">
        <span className="footer-claim">
          built on <code>@culvert/tar</code> + <code>@culvert/stream</code>
        </span>
        <span className="spacer" />
        <span>node {state.meta ? "v22+" : ""}</span>
      </footer>
    </main>
  );
}
