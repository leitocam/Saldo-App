import type { Command, FinanceState, Pending } from "./types";
import { applyCommand } from "./commands";
export type Delivery =
  | { status: "accepted" }
  | { status: "rejected"; error: string }
  | { status: "auth" }
  | { status: "retry" };
export async function deliver(
  c: Command,
  transport: typeof fetch = fetch,
): Promise<Delivery> {
  const path =
    c.type === "bootstrap"
      ? "/api/bootstrap"
      : c.type === "entity"
        ? "/api/entities"
        : c.type === "void" || c.expected_version
          ? `/api/movements/${c.id}`
          : "/api/movements";
  try {
    const response = await transport(path, {
      method:
        c.type === "void"
          ? "DELETE"
          : c.type === "movement" && c.expected_version
            ? "PUT"
            : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(c),
    });
    if (response.status === 401) return { status: "auth" };
    if (response.status >= 500 || response.status === 429)
      return { status: "retry" };
    const result = await response.json();
    if (!response.ok)
      return {
        status: "rejected",
        error: result.error ?? "No se pudo sincronizar.",
      };
    return { status: "accepted" };
  } catch {
    return { status: "retry" };
  }
}
export function rebase(state: FinanceState, pending: Pending[]) {
  let confirmed = state;
  const next: Pending[] = [];
  for (const item of pending) {
    if (item.status === "pending") {
      try {
        confirmed = applyCommand(confirmed, item.command);
        next.push(item);
      } catch (e) {
        next.push({ ...item, status: "failed", error: (e as Error).message });
      }
    } else next.push(item);
  }
  return { state: confirmed, pending: next };
}
