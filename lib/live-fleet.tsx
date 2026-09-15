"use client";

import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from "react";
import { HISTORY_LIMIT, statusFor } from "./fleet";
import type { Reading, SiteDef, Status } from "./types";

export type ConnectionState = "connecting" | "live" | "reconnecting";

export interface SensorView {
  id: string;
  name: string;
  assetId: string;
  channel: number;
  latest: Reading | null;
  status: Status;
  history: Reading[];
}

interface State {
  history: Record<string, Reading[]>;
  connection: ConnectionState;
  lastUpdate: number | null;
  selectedId: string | null;
}

type Action =
  | { type: "snapshot"; readings: Reading[] }
  | { type: "readings"; readings: Reading[] }
  | { type: "connection"; value: ConnectionState }
  | { type: "select"; id: string };

function append(history: Record<string, Reading[]>, readings: Reading[]) {
  const next = { ...history };
  for (const r of readings) {
    const list = next[r.sensorId] ? [...next[r.sensorId], r] : [r];
    next[r.sensorId] = list.length > HISTORY_LIMIT ? list.slice(-HISTORY_LIMIT) : list;
  }
  return next;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        history: append({}, action.readings),
        connection: "live",
        lastUpdate: action.readings.at(-1)?.ts ?? Date.now(),
      };
    case "readings":
      return {
        ...state,
        history: append(state.history, action.readings),
        connection: "live",
        lastUpdate: action.readings.at(-1)?.ts ?? state.lastUpdate,
      };
    case "connection":
      return { ...state, connection: action.value };
    case "select":
      return { ...state, selectedId: action.id };
  }
}

interface LiveFleet {
  site: SiteDef;
  sensors: SensorView[];
  selected: SensorView | null;
  select: (id: string) => void;
  connection: ConnectionState;
  lastUpdate: number | null;
}

const LiveFleetContext = createContext<LiveFleet | null>(null);

const STATUS_RANK: Record<Status, number> = { critical: 2, watch: 1, normal: 0 };

export function LiveFleetProvider({ site, children }: { site: SiteDef; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    history: {},
    connection: "connecting",
    lastUpdate: null,
    selectedId: null,
  });

  useEffect(() => {
    const source = new EventSource("/api/stream");
    source.addEventListener("snapshot", (e) =>
      dispatch({ type: "snapshot", readings: JSON.parse((e as MessageEvent).data) }),
    );
    source.addEventListener("readings", (e) =>
      dispatch({ type: "readings", readings: JSON.parse((e as MessageEvent).data) }),
    );
    // EventSource retries on its own; we only reflect the state.
    source.onerror = () => dispatch({ type: "connection", value: "reconnecting" });
    return () => source.close();
  }, []);

  const value = useMemo<LiveFleet>(() => {
    const sensors: SensorView[] = site.sensors.map((def) => {
      const history = state.history[def.id] ?? [];
      const latest = history.at(-1) ?? null;
      return { ...def, history, latest, status: latest ? statusFor(latest.deltaC) : "normal" };
    });

    // Default selection: the worst sensor, so attention lands where it's needed.
    const worst = [...sensors].sort(
      (a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || (b.latest?.deltaC ?? 0) - (a.latest?.deltaC ?? 0),
    )[0];
    const selected = sensors.find((s) => s.id === state.selectedId) ?? worst ?? null;

    return {
      site,
      sensors,
      selected,
      select: (id) => dispatch({ type: "select", id }),
      connection: state.connection,
      lastUpdate: state.lastUpdate,
    };
  }, [site, state]);

  return <LiveFleetContext.Provider value={value}>{children}</LiveFleetContext.Provider>;
}

export function useLiveFleet() {
  const ctx = useContext(LiveFleetContext);
  if (!ctx) throw new Error("useLiveFleet must be used inside LiveFleetProvider");
  return ctx;
}
