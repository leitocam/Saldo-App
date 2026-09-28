import Decimal from "decimal.js";
import type {
  FinanceState,
  Movement,
  Inventory,
  Lot,
  SaleResult,
  Quote,
} from "./types";
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const D = (v: Decimal.Value | null | undefined) => new Decimal(v ?? 0);
export const decimal = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(normalized))
    throw new Error("Escribe un importe válido.");
  return D(normalized).toFixed();
};
export const money = (
  v: Decimal.Value | null | undefined,
  currency = "BOB",
  maximumFractionDigits = 2,
) =>
  v === null || v === undefined
    ? "—"
    : new Intl.NumberFormat("es-BO", {
        style: "currency",
        currency,
        maximumFractionDigits,
        minimumFractionDigits: 2,
      }).format(D(v).toNumber());
export const units = (v: Decimal.Value) =>
  new Intl.NumberFormat("es-BO", { maximumFractionDigits: 8 }).format(
    D(v).toNumber(),
  );
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export const localDay = (timestamp: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(timestamp));
export const monthNow = () => today().slice(0, 7);
export const atDay = (date: string) => `${date}T12:00:00-04:00`;
export const displayDate = (date: string) =>
  new Intl.DateTimeFormat("es-BO", {
    timeZone: "America/La_Paz",
    day: "numeric",
    month: "short",
  }).format(new Date(date));
export function inventory(movements: Movement[]): Inventory {
  const lots: Lot[] = [],
    sales: SaleResult[] = [];
  const ordered = movements
    .filter((m) => !m.voided && ["buy", "sell", "opening"].includes(m.kind))
    .sort(
      (a, b) =>
        Date.parse(a.occurred_at) - Date.parse(b.occurred_at) ||
        a.id.localeCompare(b.id),
    );
  for (const m of ordered) {
    const q = D(m.usdt_quantity),
      fee = D(m.fee_usdt);
    if (m.kind === "buy" || m.kind === "opening") {
      const received = q.minus(fee);
      if (received.lte(0))
        throw new Error("Los USDT netos deben ser mayores que cero.");
      lots.push({
        id: m.id,
        date: m.occurred_at,
        remaining: received.toFixed(),
        original_quantity: received.toFixed(),
        unit_cost:
          m.amount_bob === null
            ? null
            : D(m.amount_bob).plus(m.fee_bob).div(received).toFixed(12),
      });
    } else {
      let remaining = q.plus(fee),
        cost = D(0),
        unknown = D(0);
      for (const lot of lots) {
        if (remaining.lte(0)) break;
        const used = Decimal.min(remaining, lot.remaining);
        lot.remaining = D(lot.remaining).minus(used).toFixed();
        remaining = remaining.minus(used);
        if (lot.unit_cost === null) unknown = unknown.plus(used);
        else cost = cost.plus(used.mul(lot.unit_cost));
      }
      if (remaining.gt(0))
        throw new Error(
          "No tienes suficientes USDT para esta venta, incluida su comisión.",
        );
      sales.push({
        id: m.id,
        cost: cost.toFixed(12),
        unknown_quantity: unknown.toFixed(),
        profit: unknown.gt(0)
          ? null
          : D(m.amount_bob).minus(m.fee_bob).minus(cost).toFixed(12),
        quantity: q.plus(fee).toFixed(),
      });
    }
  }
  return {
    lots,
    sales,
    quantity: lots.reduce((s, l) => s.plus(l.remaining), D(0)).toFixed(),
    known_cost: lots
      .reduce(
        (s, l) =>
          l.unit_cost === null ? s : s.plus(D(l.remaining).mul(l.unit_cost)),
        D(0),
      )
      .toFixed(12),
    unknown_quantity: lots
      .filter((l) => l.unit_cost === null)
      .reduce((s, l) => s.plus(l.remaining), D(0))
      .toFixed(),
  };
}
export function balances(state: FinanceState) {
  const result: Record<string, string> = Object.fromEntries(
    state.accounts.map((a) => [a.id, a.opening_balance]),
  );
  const add = (id: string | null, v: Decimal.Value) => {
    if (id && id in result) result[id] = D(result[id]).plus(v).toFixed();
  };
  for (const m of state.movements.filter((m) => !m.voided && !m.history_only)) {
    const amount = D(m.amount_bob);
    if (["expense", "buy"].includes(m.kind))
      add(m.account_id, amount.plus(m.fee_bob).neg());
    if (["income", "sell"].includes(m.kind))
      add(m.account_id, amount.minus(m.fee_bob));
    if (m.kind === "adjustment") add(m.account_id, amount);
    if (m.kind === "transfer") {
      add(m.account_id, amount.plus(m.fee_bob).neg());
      add(m.destination_id, amount);
    }
  }
  return result;
}
export const reserved = (s: FinanceState) =>
  s.goals
    .filter((g) => !g.archived)
    .reduce((sum, g) => sum.plus(g.reserved_usdt), D(0));
export function validInventory(s: FinanceState) {
  const i = inventory(s.movements);
  if (reserved(s).gt(i.quantity))
    throw new Error("Libera USDT de tus metas antes de reducir este saldo.");
  return i;
}
export function periodMovements(s: FinanceState, from: string, to: string) {
  return s.movements.filter(
    (m) =>
      !m.voided &&
      !m.history_only &&
      localDay(m.occurred_at) >= from &&
      localDay(m.occurred_at) <= to,
  );
}
export function report(
  s: FinanceState,
  from: string,
  to: string,
  account = "",
  category = "",
) {
  const movements = periodMovements(s, from, to).filter(
    (m) =>
      (!account || m.account_id === account || m.destination_id === account) &&
      (!category || m.category_id === category),
  );
  const sum = (kind: string) =>
    movements
      .filter((m) => m.kind === kind)
      .reduce((a, m) => a.plus(D(m.amount_bob)), D(0));
  const income = sum("income"),
    expense = sum("expense");
  const expensesByCategory = s.categories
    .filter((c) => c.type === "expense")
    .map((c) => ({
      ...c,
      amount: movements
        .filter((m) => m.kind === "expense" && m.category_id === c.id)
        .reduce((a, m) => a.plus(D(m.amount_bob)), D(0))
        .toFixed(),
    }))
    .filter((c) => D(c.amount).gt(0))
    .sort((a, b) => D(b.amount).cmp(a.amount));
  const i = inventory(s.movements),
    ids = new Set(movements.map((m) => m.id));
  const sales = i.sales.filter((x) => ids.has(x.id)),
    profit = sales.reduce((a, x) => a.plus(x.profit ?? 0), D(0));
  return {
    movements,
    income: income.toFixed(),
    expense: expense.toFixed(),
    net: income.minus(expense).toFixed(),
    expensesByCategory,
    profit: profit.toFixed(),
    incompleteSales: sales.some((x) => x.profit === null),
    buy: sum("buy").toFixed(),
    sell: sum("sell").toFixed(),
  };
}
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: `${month}-${new Date(Date.UTC(y, m, 0)).getUTCDate()}`,
  };
}
export function previousMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
}
export const latestQuote = (s: FinanceState): Quote | undefined =>
  [...s.quotes].sort(
    (a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at),
  )[0];
export const quoteStale = (q: Quote | undefined) =>
  !q || Date.now() - Date.parse(q.observed_at) > 15 * 60 * 1000;
export function nextDue(date: string, frequency: string, anchor: number) {
  const [y, m, d] = date.split("-").map(Number);
  if (frequency === "weekly")
    return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
  const nextMonth = frequency === "yearly" ? m - 1 : m;
  const nextYear = frequency === "yearly" ? y + 1 : y;
  const last = new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(nextYear, nextMonth, Math.min(anchor, last)))
    .toISOString()
    .slice(0, 10);
}
export const csvCell = (s: string) =>
  `"${(/^[=+\-@\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
export function csv(s: FinanceState, movements: Movement[]) {
  const accounts = Object.fromEntries(s.accounts.map((a) => [a.id, a.name])),
    cats = Object.fromEntries(s.categories.map((c) => [c.id, c.name]));
  return (
    "\uFEFF" +
    [
      [
        "Fecha",
        "Tipo",
        "Cuenta",
        "Destino",
        "Categoría",
        "BOB",
        "USDT",
        "Comisión BOB",
        "Comisión USDT",
        "Descripción",
      ],
      ...movements.map((m) => [
        localDay(m.occurred_at),
        m.kind,
        accounts[m.account_id ?? ""] ?? "",
        accounts[m.destination_id ?? ""] ?? "",
        cats[m.category_id ?? ""] ?? "",
        m.amount_bob ?? "",
        m.usdt_quantity,
        m.fee_bob,
        m.fee_usdt,
        m.note,
      ]),
    ]
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n")
  );
}
