import { cToF } from "@/lib/fleet";

export const formatF = (deltaC: number | undefined | null, digits = 1) =>
  deltaC == null ? "–" : cToF(deltaC).toFixed(digits);

export const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
