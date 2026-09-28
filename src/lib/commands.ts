import { z } from "zod";
import type {
  Command,
  FinanceState,
  Movement,
  Account,
  Category,
  Goal,
  Budget,
  Recurring,
  Profile,
  Quote,
} from "./types";
import { D, validInventory, today, localDay, nextDue } from "./finance";
export function equivalentMovement(a: Movement, b: Movement) {
  const fields = [
    "kind",
    "account_id",
    "destination_id",
    "category_id",
    "note",
    "history_only",
    "recurring_key",
  ] as const;
  return (
    fields.every((k) => a[k] === b[k]) &&
    Date.parse(a.occurred_at) === Date.parse(b.occurred_at) &&
    ["amount_bob", "usdt_quantity", "fee_bob", "fee_usdt"].every((k) => {
      const key = k as "amount_bob" | "usdt_quantity" | "fee_bob" | "fee_usdt";
      return a[key] === null || b[key] === null
        ? a[key] === b[key]
        : D(a[key]).eq(D(b[key]));
    })
  );
}
function sameEntity(a: unknown, b: unknown): boolean {
  if (typeof a === "string" && typeof b === "string") {
    if (/^-?\d+(\.\d+)?$/.test(a) && /^-?\d+(\.\d+)?$/.test(b))
      return D(a).eq(b);
    if (
      a.includes("T") &&
      b.includes("T") &&
      Number.isFinite(Date.parse(a)) &&
      Number.isFinite(Date.parse(b))
    )
      return Date.parse(a) === Date.parse(b);
    return a === b;
  }
  if (Array.isArray(a) && Array.isArray(b))
    return (
      a.length === b.length && a.every((value, i) => sameEntity(value, b[i]))
    );
  if (a && b && typeof a === "object" && typeof b === "object")
    return Object.entries(a)
      .filter(([k]) => k !== "version")
      .every(([k, v]) => sameEntity(v, (b as Record<string, unknown>)[k]));
  return a === b;
}
const amount = z.string().regex(/^-?\d+(\.\d{1,8})?$/);
const positive = amount.refine(
  (x) => D(x).gte(0),
  "El importe no puede ser negativo.",
);
const uuid = z.string().uuid();
export const movementSchema = z.object({
  id: uuid,
  kind: z.enum([
    "expense",
    "income",
    "transfer",
    "buy",
    "sell",
    "opening",
    "adjustment",
  ]),
  account_id: uuid.nullable(),
  destination_id: uuid.nullable(),
  category_id: uuid.nullable(),
  amount_bob: amount.nullable(),
  usdt_quantity: positive,
  fee_bob: positive,
  fee_usdt: positive,
  occurred_at: z.string().datetime({ offset: true }),
  note: z.string().max(1000),
  history_only: z.boolean(),
  voided: z.boolean().default(false),
  version: z.number().int().positive().default(1),
  recurring_key: z.string().max(100).nullable(),
});
export const commandSchema = z.object({
  id: uuid,
  type: z.enum(["movement", "void", "entity", "bootstrap"]),
  entity: z
    .enum([
      "account",
      "category",
      "goal",
      "budget",
      "recurring",
      "profile",
      "quote",
    ])
    .optional(),
  payload: z.record(z.string(), z.unknown()),
  expected_version: z.number().int().positive().optional(),
});
const text = z.string().trim().min(1).max(80);
export const entitySchemas = {
  account: z.object({
    id: uuid,
    name: text,
    bank_method: z.string().max(100),
    type: z.enum(["bank", "cash"]),
    opening_balance: amount.refine((v) => D(v).decimalPlaces() <= 2),
    archived: z.boolean(),
    version: z.number().int().positive(),
  }),
  category: z.object({
    id: uuid,
    name: text,
    type: z.enum(["expense", "income"]),
    icon: z.string().max(40),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    favorite: z.boolean(),
    position: z.number().int().min(0),
    archived: z.boolean(),
    version: z.number().int().positive(),
  }),
  goal: z.object({
    id: uuid,
    name: text,
    target_amount: positive.refine((v) => D(v).gt(0)),
    target_currency: z.enum(["BOB", "USDT"]),
    reserved_usdt: positive,
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    archived: z.boolean(),
    version: z.number().int().positive(),
  }),
  budget: z.object({
    id: uuid,
    category_id: uuid,
    month: z.string().regex(/^\d{4}-\d{2}$/),
    amount: positive.refine((v) => D(v).gt(0) && D(v).decimalPlaces() <= 2),
    version: z.number().int().positive(),
  }),
  recurring: z.object({
    id: uuid,
    name: text,
    amount: positive.refine((v) => D(v).gt(0) && D(v).decimalPlaces() <= 2),
    category_id: uuid,
    account_id: uuid,
    frequency: z.enum(["monthly", "weekly", "yearly"]),
    next_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    anchor_day: z.number().int().min(1).max(31),
    archived: z.boolean(),
    version: z.number().int().positive(),
  }),
  profile: z.object({
    display_name: text,
    cutoff: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    onboarded: z.boolean(),
    version: z.number().int().positive(),
    quote_settings: z.object({
      banks: z.array(z.string().max(100)).max(20),
      quantity: positive.refine((x) => D(x).gt(0)),
      min_orders: z.number().int().min(0),
      min_completion: z.number().min(0).max(1),
      min_positive: z.number().min(0).max(1),
    }),
  }),
  quote: z.object({
    id: uuid,
    price: positive.refine((v) => D(v).gt(0)),
    observed_at: z.string().datetime({ offset: true }),
    source: z.enum(["manual", "binance"]),
    sample_count: z.number().int().min(0).max(20),
    quantity: positive,
    banks: z.array(z.string()),
  }),
};
export function validateMovement(m: Movement, s: FinanceState) {
  const a = s.accounts.find((a) => a.id === m.account_id);
  if (m.kind !== "opening" && (!a || a.archived))
    throw new Error("Elige una cuenta activa.");
  if (m.kind !== "opening" && m.amount_bob === null)
    throw new Error("Falta el importe en bolivianos.");
  if (m.amount_bob !== null && D(m.amount_bob).decimalPlaces() > 2)
    throw new Error("Los bolivianos admiten dos decimales.");
  if (D(m.fee_bob).decimalPlaces() > 2)
    throw new Error("La comisión en BOB admite dos decimales.");
  if (m.kind !== "adjustment" && m.kind !== "opening" && D(m.amount_bob).lte(0))
    throw new Error("El importe debe ser mayor que cero.");
  if (
    ["expense", "income"].includes(m.kind) &&
    !s.categories.some(
      (c) => c.id === m.category_id && c.type === m.kind && !c.archived,
    )
  )
    throw new Error("Elige una categoría válida.");
  if (
    m.kind === "transfer" &&
    (m.destination_id === m.account_id ||
      !s.accounts.some((a) => a.id === m.destination_id && !a.archived))
  )
    throw new Error("Elige otra cuenta de destino.");
  if (["buy", "sell", "opening"].includes(m.kind) && D(m.usdt_quantity).lte(0))
    throw new Error("La cantidad de USDT debe ser mayor que cero.");
  if (
    !["buy", "sell", "opening"].includes(m.kind) &&
    (!D(m.usdt_quantity).isZero() || !D(m.fee_usdt).isZero())
  )
    throw new Error("Esta operación no usa USDT.");
  if (
    ["expense", "income", "adjustment", "opening"].includes(m.kind) &&
    !D(m.fee_bob).isZero()
  )
    throw new Error("Registra la comisión como un gasto separado.");
  if (m.kind === "sell" && D(m.fee_bob).gt(D(m.amount_bob)))
    throw new Error("La comisión supera los bolivianos recibidos.");
  if (m.history_only && !["buy", "sell", "opening"].includes(m.kind))
    throw new Error("Solo Binance admite historial de apertura.");
  if (m.kind === "opening" && !m.history_only)
    throw new Error("La apertura debe pertenecer al historial inicial.");
  if (m.kind === "opening" && m.amount_bob !== null && D(m.amount_bob).lt(0))
    throw new Error("El costo de apertura no puede ser negativo.");
  if (!["expense", "income"].includes(m.kind) && m.category_id !== null)
    throw new Error("Esta operación no utiliza categoría.");
  if (m.kind !== "transfer" && m.destination_id !== null)
    throw new Error("Esta operación no utiliza cuenta de destino.");
  if (s.profile.onboarded) {
    if (m.history_only && localDay(m.occurred_at) > s.profile.cutoff)
      throw new Error("El historial debe ser anterior a la fecha de corte.");
    if (!m.history_only && localDay(m.occurred_at) < s.profile.cutoff)
      throw new Error(
        "Usa el historial de Binance para operaciones anteriores al inicio.",
      );
  }
}
export function applyCommand(state: FinanceState, raw: Command): FinanceState {
  const c = commandSchema.parse(raw),
    s = structuredClone(state);
  if (c.type === "bootstrap") {
    const candidate = c.payload as unknown as FinanceState;
    s.profile = entitySchemas.profile.parse(candidate.profile);
    if (state.profile.onboarded) {
      if (
        candidate.profile.cutoff === state.profile.cutoff &&
        candidate.accounts.length > 0 &&
        candidate.accounts.every((a) =>
          state.accounts.some((x) => x.id === a.id),
        ) &&
        candidate.categories.every((a) =>
          state.categories.some((x) => x.id === a.id),
        ) &&
        candidate.movements.every((a) =>
          state.movements.some((x) => x.id === a.id),
        )
      )
        return state;
      throw new Error("Esta cuenta ya está configurada.");
    }
    s.accounts = candidate.accounts.map((a) => entitySchemas.account.parse(a));
    s.categories = candidate.categories.map((a) =>
      entitySchemas.category.parse(a),
    );
    s.movements = candidate.movements.map((m) => movementSchema.parse(m));
    s.goals = [];
    s.budgets = [];
    s.recurring = [];
    s.quotes = [];
    for (const m of s.movements) validateMovement(m, s);
    validInventory(s);
    return s;
  }
  if (c.type === "movement") {
    const m = movementSchema.parse(c.payload);
    if (m.id !== c.id) throw new Error("Identificador inválido.");
    const idx = s.movements.findIndex((x) => x.id === c.id);
    if (idx >= 0) {
      if (
        c.expected_version !== undefined &&
        s.movements[idx].version === c.expected_version + 1 &&
        equivalentMovement(s.movements[idx], m)
      )
        return s;
      if (c.expected_version === undefined) {
        if (!equivalentMovement(s.movements[idx], m))
          throw new Error(
            "Este identificador ya se utilizó para otra operación.",
          );
        return s;
      }
      if (s.movements[idx].version !== c.expected_version)
        throw new Error(
          "El movimiento cambió en otro dispositivo. Actualiza antes de editarlo.",
        );
      m.version = c.expected_version + 1;
      s.movements[idx] = m;
    } else {
      s.movements.push(m);
    }
    validateMovement(m, s);
    if (
      m.recurring_key &&
      s.movements.some(
        (x) =>
          x.id !== m.id && !x.voided && x.recurring_key === m.recurring_key,
      )
    )
      throw new Error("Este pago recurrente ya fue confirmado.");
    if (m.recurring_key && !c.expected_version) {
      const r = s.recurring.find(
        (r) => `${r.id}:${r.next_date}` === m.recurring_key && !r.archived,
      );
      if (r) {
        if (
          m.kind !== "expense" ||
          m.account_id !== r.account_id ||
          m.category_id !== r.category_id ||
          !D(m.amount_bob).eq(r.amount)
        )
          throw new Error("El pago no coincide con el recurrente.");
        r.next_date = nextDue(r.next_date, r.frequency, r.anchor_day);
        r.version++;
      }
    }
  } else if (c.type === "void") {
    const m = s.movements.find((x) => x.id === c.id);
    if (!m) throw new Error("No encontramos el movimiento.");
    if (m.voided && m.version === Number(c.expected_version) + 1) return s;
    if (m.version !== c.expected_version)
      throw new Error("El movimiento cambió en otro dispositivo.");
    m.voided = true;
    m.version++;
  } else {
    const entity = c.entity;
    if (!entity) throw new Error("Falta el tipo de configuración.");
    const value = entitySchemas[entity].parse(c.payload);
    if (entity === "profile") {
      if (
        s.profile.version === Number(c.expected_version) + 1 &&
        sameEntity(value, s.profile)
      )
        return s;
      if (c.expected_version !== s.profile.version)
        throw new Error("Los ajustes cambiaron en otro dispositivo.");
      if ((value as Profile).cutoff !== s.profile.cutoff)
        throw new Error(
          "La fecha de corte no se puede cambiar después del inicio.",
        );
      s.profile = { ...(value as Profile), version: s.profile.version + 1 };
    } else {
      const key = {
        account: "accounts",
        category: "categories",
        goal: "goals",
        budget: "budgets",
        recurring: "recurring",
        quote: "quotes",
      }[entity] as Exclude<keyof FinanceState, "profile" | "movements">;
      const list = s[key] as (
        | Account
        | Category
        | Goal
        | Budget
        | Recurring
        | Quote
      )[];
      const v = value as Account | Category | Goal | Budget | Recurring | Quote;
      if (v.id !== c.id) throw new Error("Identificador inválido.");
      const idx = list.findIndex((x) => x.id === c.id);
      if (
        idx >= 0 &&
        sameEntity(v, list[idx]) &&
        (c.expected_version === undefined ||
          ("version" in list[idx] &&
            list[idx].version === c.expected_version + 1))
      )
        return s;
      if (
        entity === "category" &&
        idx >= 0 &&
        (v as Category).type !== (list[idx] as Category).type &&
        s.movements.some((m) => m.category_id === v.id)
      )
        throw new Error(
          "No se puede cambiar el tipo de una categoría con historial.",
        );
      if (idx >= 0) {
        if (
          !("version" in list[idx]) ||
          c.expected_version !== list[idx].version
        )
          throw new Error("Este registro cambió en otro dispositivo.");
        if ("version" in v) v.version = (c.expected_version ?? 0) + 1;
        list[idx] = v;
      } else list.push(v);
      if (
        entity === "account" &&
        idx >= 0 &&
        D((v as Account).opening_balance).cmp(
          state.accounts.find((a) => a.id === v.id)!.opening_balance,
        ) !== 0
      )
        throw new Error("Usa un ajuste para conciliar el saldo.");
      if (
        entity === "goal" &&
        (v as Goal).archived &&
        !D((v as Goal).reserved_usdt).isZero()
      )
        throw new Error("Libera los USDT antes de archivar la meta.");
      if (
        entity === "goal" &&
        (v as Goal).target_currency === "BOB" &&
        D((v as Goal).target_amount).decimalPlaces() > 2
      )
        throw new Error("BOB admite dos decimales.");
      if (entity === "budget" || entity === "recurring") {
        const e = v as Budget | Recurring;
        if (
          !s.categories.some(
            (x) =>
              x.id === e.category_id && x.type === "expense" && !x.archived,
          )
        )
          throw new Error("Elige una categoría de gasto activa.");
        if (
          entity === "budget" &&
          s.budgets.some(
            (x) =>
              x.id !== v.id &&
              x.category_id === e.category_id &&
              x.month === (v as Budget).month,
          )
        )
          throw new Error("Esta categoría ya tiene presupuesto para ese mes.");
        if (
          entity === "recurring" &&
          !s.accounts.some(
            (x) => x.id === (v as Recurring).account_id && !x.archived,
          )
        )
          throw new Error("Elige una cuenta activa.");
      }
    }
  }
  validInventory(s);
  return s;
}
