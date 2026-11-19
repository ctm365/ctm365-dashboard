import type { ServiceId, Services } from "./types";

/**
 * The monitoring services a customer can have, in the order the dashboard
 * tabs show them. No server-only import, so pages and client components
 * share the same labels and paths.
 */
export const SERVICES: readonly { id: ServiceId; label: string; path: string }[] = [
  { id: "electrical", label: "Electrical", path: "/electrical" },
  { id: "hvac", label: "HVAC", path: "/hvac" },
];

export const NO_SERVICES: Services = { electrical: false, hvac: false };

/** The services this customer has, in tab order. Empty when none are on. */
export function enabledServices(services: Services) {
  return SERVICES.filter((s) => services[s.id]);
}
