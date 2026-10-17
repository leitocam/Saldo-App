import { z } from "zod";
import {
  entitySchemas,
  movementSchema,
  validateMovement,
  commandSchema,
} from "./commands";
import { D, balances, inventory, validInventory } from "./finance";
import { planningSchema, planningState, validatePlanning } from "./planning";
import type { FinanceState, Pending } from "./types";

export const MAX_BACKUP_BYTES = 3_000_000;
export type Backup = {
  app: "Saldo";
  format: 2;
  exported_at: string;
  owner: string;
  state: FinanceState;
  pending_count: number;
  pending_commands?: Pending[];
};
export function validateSnapshot(raw: unknown): FinanceState {
  const schema = z.object({
    profile: entitySchemas.profile,
    accounts: z.array(entitySchemas.account).max(500),
    categories: z.array(entitySchemas.category).max(1000),
    movements: z.array(movementSchema).max(15000),
    goals: z.array(entitySchemas.goal).max(500),
    budgets: z.array(entitySchemas.budget).max(5000),
    recurring: z.array(entitySchemas.recurring).max(500),
    quotes: z.array(entitySchemas.quote).max(10000),
    planning: planningSchema.optional(),
  });
  const s = schema.parse(raw) as FinanceState;
  if (!s.profile.onboarded || !s.accounts.length)
    throw new Error("El respaldo debe contener un espacio configurado.");
  for (const key of [
    "accounts",
    "categories",
    "movements",
    "goals",
    "budgets",
    "recurring",
    "quotes",
  ] as const)
    if (new Set(s[key].map((x) => x.id)).size !== s[key].length)
      throw new Error(`Identificadores repetidos en ${key}.`);
  const active = {
    ...s,
    accounts: s.accounts.map((a) => ({ ...a, archived: false })),
    categories: s.categories.map((c) => ({ ...c, archived: false })),
  };
  for (const m of s.movements) validateMovement(m, active);
  for (const budget of s.budgets)
    if (
      !s.categories.some(
        (c) => c.id === budget.category_id && c.type === "expense",
      )
    )
      throw new Error("Un presupuesto no tiene categoría válida.");
  for (const r of s.recurring)
    if (
      !s.accounts.some((a) => a.id === r.account_id) ||
      !s.categories.some((c) => c.id === r.category_id && c.type === "expense")
    )
      throw new Error("Un recurrente tiene referencias inválidas.");
  if (
    new Set(s.budgets.map((b) => `${b.month}:${b.category_id}`)).size !==
    s.budgets.length
  )
    throw new Error(
      "Hay presupuestos duplicados para el mismo mes y categoría.",
    );
  const recurringKeys = s.movements
    .filter((m) => !m.voided && m.recurring_key)
    .map((m) => m.recurring_key);
  if (new Set(recurringKeys).size !== recurringKeys.length)
    throw new Error("Hay pagos recurrentes duplicados en el respaldo.");
  validInventory(s);
  validInventory(s, "USDC");
  validatePlanning(s);
  return { ...s, planning: planningState(s) };
}
export function readBackup(raw: unknown): Backup {
  const b = z
    .object({
      app: z.literal("Saldo"),
      format: z.literal(2),
      exported_at: z.string().datetime({ offset: true }),
      owner: z.string().min(1).max(120),
      state: z.unknown(),
      pending_count: z.number().int().nonnegative().default(0),
      pending_commands: z
        .array(
          z.object({
            command: commandSchema,
            status: z.enum(["pending", "failed"]),
            error: z.string().max(1000).optional(),
          }),
        )
        .max(1000)
        .optional(),
    })
    .parse(raw);
  if (b.pending_commands && b.pending_commands.length !== b.pending_count)
    throw new Error(
      "El archivo no coincide con su lista de operaciones pendientes.",
    );
  return { ...b, state: validateSnapshot(b.state) };
}
export function createBackup(
  s: FinanceState,
  owner: string,
  pendingCount = 0,
  pendingCommands: Pending[] = [],
): Backup {
  return {
    app: "Saldo",
    format: 2,
    exported_at: new Date().toISOString(),
    owner,
    state: validateSnapshot(s),
    pending_count: pendingCount,
    pending_commands: structuredClone(pendingCommands),
  };
}
const canonical = (value: unknown): unknown => {
  if (typeof value === "string") {
    if (/^-?\d+(\.\d+)?$/.test(value)) return D(value).toFixed();
    if (/^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)))
      return new Date(value).toISOString();
  }
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== "version")
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
async function remap(s: FinanceState, owner: string) {
  const ids = new Set<string>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "id" && typeof x === "string") ids.add(x);
        collect(x);
      }
    }
  };
  collect(s);
  const map = new Map<string, string>();
  for (const id of ids) {
    const bytes = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(`saldo-restore-v2:${owner}:${id}`),
      ),
    ).slice(0, 16);
    bytes[6] = (bytes[6] & 15) | 80;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
      "",
    );
    map.set(
      id,
      `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
    );
  }
  const visit = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (map.has(v)) return map.get(v);
      const [prefix, date] = v.split(":");
      if (date && map.has(prefix)) return `${map.get(prefix)}:${date}`;
      return v;
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, visit(x)]),
      );
    return v;
  };
  return visit(s) as FinanceState;
}
export async function prepareRestore(
  current: FinanceState,
  raw: unknown,
  targetOwner: string,
) {
  if (current.profile.onboarded) current = validateSnapshot(current);
  const backup = readBackup(raw),
    remapped = backup.owner !== targetOwner;
  const source = remapped
    ? await remap(backup.state, targetOwner)
    : backup.state;
  if (
    current.profile.onboarded &&
    current.profile.cutoff !== source.profile.cutoff
  )
    throw new Error(
      "El respaldo tiene otra fecha de inicio. Restaura en un espacio nuevo para evitar mezclar saldos iniciales.",
    );
  const merged = structuredClone(current.profile.onboarded ? current : source),
    delta = structuredClone(source);
  let added = 0,
    duplicates = 0;
  const counts: Record<string, number> = {};
  for (const key of [
    "accounts",
    "categories",
    "movements",
    "goals",
    "budgets",
    "recurring",
    "quotes",
  ] as const) {
    const existing = current.profile.onboarded ? current[key] : [];
    const novel = source[key].filter((row) => {
      const previous = existing.find((x) => x.id === row.id);
      if (!previous) return true;
      if (!same(previous, row))
        throw new Error(
          `Conflicto en ${key}: ${"name" in row ? row.name : row.id}. El respaldo no sobrescribirá este registro.`,
        );
      duplicates++;
      return false;
    });
    counts[key] = novel.length;
    added += novel.length;
    Object.assign(delta, { [key]: novel });
    Object.assign(merged, { [key]: [...existing, ...novel] });
  }
  const oldPlanning = planningState(
    current.profile.onboarded ? current : { ...current, planning: undefined },
  );
  const nextPlanning = structuredClone(oldPlanning),
    sourcePlanning = planningState(source);
  for (const key of ["debts", "card_drafts", "reconciliations"] as const) {
    const existing = oldPlanning[key];
    const novel = sourcePlanning[key].filter((row) => {
      const previous = existing.find((x) => x.id === row.id);
      if (!previous) return true;
      if (!same(previous, row))
        throw new Error(
          `Conflicto en ${key}: no se sobrescriben cambios posteriores al respaldo.`,
        );
      duplicates++;
      return false;
    });
    Object.assign(nextPlanning, { [key]: [...existing, ...novel] });
    counts[key] = novel.length;
    added += novel.length;
  }
  if (!nextPlanning.usdc_reference && sourcePlanning.usdc_reference) {
    nextPlanning.usdc_reference = sourcePlanning.usdc_reference;
    added++;
    counts.usdc_reference = 1;
  }
  merged.planning = nextPlanning;
  delta.planning = nextPlanning;
  delta.profile = merged.profile;
  validateSnapshot(merged);
  const cash = Object.values(balances(merged))
    .reduce((sum, v) => sum.plus(v), D(0))
    .toFixed(2);
  return {
    merged,
    delta,
    added,
    duplicates,
    counts,
    remapped,
    pending: backup.pending_count,
    summary: {
      cash,
      usdt: inventory(merged.movements).quantity,
      usdc: inventory(merged.movements, "USDC").quantity,
    },
  };
}
