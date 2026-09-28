import { openDB } from "idb";
import type { FinanceState, Pending } from "./types";
const database = () =>
  openDB("saldo-v1", 1, {
    upgrade(db) {
      db.createObjectStore("workspaces");
    },
  });
export type Workspace = { state: FinanceState; pending: Pending[] };
export async function readWorkspace(
  user: string,
): Promise<Workspace | undefined> {
  return (await database()).get("workspaces", user);
}
export async function writeWorkspace(user: string, data: Workspace) {
  await (await database()).put("workspaces", data, user);
}
export async function clearWorkspace(user: string) {
  await (await database()).delete("workspaces", user);
}
