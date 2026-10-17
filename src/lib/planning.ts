import { z } from "zod";
import {
  D,
  balances,
  inventory,
  monthRange,
  nextDue,
  reserved,
  today,
  localDay,
} from "./finance";
import type { Command, Debt, FinanceState, Planning } from "./types";

const uuid = z.string().uuid();
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const date = new Date(`${v}T12:00:00Z`);
    return (
      Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v
    );
  }, "Fecha inválida");
const decimal = z.string().regex(/^\d+(\.\d{1,8})?$/);
const bob = decimal.refine((v) => D(v).gt(0) && D(v).decimalPlaces() <= 2);
const text = z.string().trim().min(1).max(120);
export const planningSchema = z.object({
  version: z.number().int().nonnegative(),
  debts: z
    .array(
      z.object({
        id: uuid,
        name: text,
        direction: z.enum(["receivable", "payable"]),
        principal: bob,
        due_date: day.nullable(),
        note: z.string().max(1000),
        archived: z.boolean(),
        opening_movement_id: uuid.nullable(),
        payments: z
          .array(
            z.object({
              id: uuid,
              amount: bob,
              date: day,
              account_id: uuid,
              movement_id: uuid,
            }),
          )
          .max(1000),
      }),
    )
    .max(500),
  card_drafts: z
    .array(
      z.object({
        id: uuid,
        note: text,
        amount_bob: bob,
        usdt_quantity: decimal.refine((v) => D(v).gt(0)),
        category_id: uuid,
        date: day,
        card_currency: z.string().regex(/^[A-Z]{3}$/),
        card_amount: bob,
        status: z.enum(["pending", "cancelled", "completed"]),
      }),
    )
    .max(1000),
  reconciliations: z
    .array(
      z.object({
        id: uuid,
        asset: z.enum(["USDT", "USDC"]),
        recorded: decimal,
        observed: decimal,
        date: day,
        note: text,
        movement_id: uuid.nullable(),
      }),
    )
    .max(5000),
  usdc_reference: z
    .object({
      price: decimal.refine((v) => D(v).gt(0)),
      observed_at: z.string().datetime({ offset: true }),
    })
    .nullable(),
});
export const planningState = (s: FinanceState): Planning =>
  s.planning ?? {
    version: 0,
    debts: [],
    card_drafts: [],
    reconciliations: [],
    usdc_reference: null,
  };
export const debtRemaining = (d: Debt) =>
  D(d.principal).minus(d.payments.reduce((sum, p) => sum.plus(p.amount), D(0)));
export function debtTotals(s: FinanceState) {
  const debts = planningState(s).debts.filter((d) => !d.archived);
  const receivable = debts
    .filter((d) => d.direction === "receivable")
    .reduce((sum, d) => sum.plus(debtRemaining(d)), D(0));
  const payable = debts
    .filter((d) => d.direction === "payable")
    .reduce((sum, d) => sum.plus(debtRemaining(d)), D(0));
  return { receivable, payable, net: receivable.minus(payable) };
}
export function planningCommand(s: FinanceState, next: Planning): Command {
  return {
    id: crypto.randomUUID(),
    type: "planning",
    payload: next as unknown as Record<string, unknown>,
    ...(planningState(s).version
      ? { expected_version: planningState(s).version }
      : {}),
  };
}
export function validatePlanning(s: FinanceState) {
  const p = planningSchema.parse(planningState(s));
  for (const key of ["debts", "card_drafts", "reconciliations"] as const)
    if (new Set(p[key].map((x) => x.id)).size !== p[key].length)
      throw new Error("Hay identificadores duplicados en tus herramientas.");
  const linked = new Set<string>();
  for (const d of p.debts) {
    if (debtRemaining(d).lt(0) || (d.archived && !debtRemaining(d).isZero()))
      throw new Error(
        "La deuda tiene pagos excesivos o sigue pendiente al archivarla.",
      );
    const check = (
      id: string,
      expected: string,
      account?: string,
      date?: string,
    ) => {
      const m = s.movements.find((x) => x.id === id && !x.voided);
      if (
        linked.has(id) ||
        !m ||
        m.kind !== "adjustment" ||
        !D(m.amount_bob).eq(expected) ||
        (account && m.account_id !== account) ||
        (date && localDay(m.occurred_at) !== date)
      )
        throw new Error(
          "El movimiento de una deuda no coincide. Gestiona sus pagos desde Deudas.",
        );
      linked.add(id);
    };
    if (d.opening_movement_id)
      check(
        d.opening_movement_id,
        D(d.principal)
          .mul(d.direction === "receivable" ? -1 : 1)
          .toFixed(),
      );
    for (const payment of d.payments)
      check(
        payment.movement_id,
        D(payment.amount)
          .mul(d.direction === "receivable" ? 1 : -1)
          .toFixed(),
        payment.account_id,
        payment.date,
      );
  }
  for (const draft of p.card_drafts) {
    if (
      !s.categories.some(
        (c) => c.id === draft.category_id && c.type === "expense",
      )
    )
      throw new Error("La categoría del cargo pendiente no existe.");
    if (
      draft.status === "completed" &&
      !s.movements.some(
        (m) =>
          m.id === draft.id &&
          m.kind === "card" &&
          !m.voided &&
          D(m.amount_bob).eq(draft.amount_bob) &&
          D(m.usdt_quantity).eq(draft.usdt_quantity) &&
          m.category_id === draft.category_id &&
          m.card_currency === draft.card_currency &&
          D(m.card_amount).eq(draft.card_amount),
      )
    )
      throw new Error("Gestiona los cambios de este cargo desde Tarjeta.");
  }
  for (const r of p.reconciliations)
    if (r.movement_id) {
      const m = s.movements.find((x) => x.id === r.movement_id && !x.voided),
        diff = D(r.observed).minus(r.recorded);
      if (
        !m ||
        (m.asset ?? "USDT") !== r.asset ||
        !D(m.usdt_quantity).eq(diff.abs()) ||
        m.kind !== (diff.gt(0) ? "crypto_in" : "crypto_out")
      )
        throw new Error(
          "La conciliación no coincide con su ajuste. Registra una nueva conciliación.",
        );
    }
  const refundTotals = new Map<string, string>();
  for (const m of s.movements.filter((m) => !m.voided && m.kind === "refund")) {
    const original = s.movements.find(
      (x) => x.id === m.parent_id && x.kind === "card" && !x.voided,
    );
    if (
      !original ||
      m.category_id !== original.category_id ||
      Date.parse(m.occurred_at) < Date.parse(original.occurred_at)
    )
      throw new Error(
        "La devolución debe referirse a un consumo válido y su categoría.",
      );
    const total = D(refundTotals.get(original.id)).plus(m.amount_bob ?? 0);
    if (total.gt(original.amount_bob ?? 0))
      throw new Error(
        "Las devoluciones superan el importe del consumo original.",
      );
    refundTotals.set(original.id, total.toFixed());
  }
}
export function monthlyAvailable(s: FinanceState, asOf = today()) {
  const end = monthRange(asOf.slice(0, 7)).to;
  const payments: {
    id: string;
    name: string;
    date: string;
    amount: string;
    overdue: boolean;
  }[] = [];
  for (const recurring of s.recurring.filter((r) => !r.archived)) {
    let date = recurring.next_date;
    for (let n = 0; date <= end && n < 1200; n++) {
      payments.push({
        id: `${recurring.id}:${date}`,
        name: recurring.name,
        date,
        amount: recurring.amount,
        overdue: date < asOf,
      });
      const next = nextDue(date, recurring.frequency, recurring.anchor_day);
      if (next <= date) throw new Error("Frecuencia de pago inválida.");
      date = next;
      if (n === 1199 && date <= end)
        throw new Error("Revisa la fecha de un recurrente muy antiguo.");
    }
  }
  for (const debt of planningState(s).debts.filter(
    (d) =>
      !d.archived &&
      d.direction === "payable" &&
      d.due_date &&
      d.due_date <= end &&
      debtRemaining(d).gt(0),
  ))
    payments.push({
      id: debt.id,
      name: `Deuda · ${debt.name}`,
      date: debt.due_date!,
      amount: debtRemaining(debt).toFixed(),
      overdue: debt.due_date! < asOf,
    });
  const cash = Object.values(balances(s)).reduce((sum, v) => sum.plus(v), D(0));
  const committed = payments.reduce((sum, p) => sum.plus(p.amount), D(0));
  const free = cash.minus(committed);
  const days = Number(end.slice(8)) - Number(asOf.slice(8)) + 1;
  return {
    cash,
    committed,
    free,
    daily: free.gt(0) ? free.div(days).toDecimalPlaces(2, 1) : D(0),
    days,
    payments: payments.sort((a, b) => a.date.localeCompare(b.date)),
    availableUsdt: D(inventory(s.movements).quantity).minus(reserved(s)),
  };
}
