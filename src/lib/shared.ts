import { D } from "./finance";
export type SharedMember = { user_id: string; display_name: string };
export type SharedExpense = {
  id: string;
  paid_by: string;
  created_by: string;
  amount: string;
  shares: { user_id: string; amount: string }[];
  note: string;
  date: string;
  voided: boolean;
  version: number;
};
export type SharedSettlement = {
  id: string;
  from_id: string;
  to_id: string;
  amount: string;
  date: string;
  status: "pending" | "confirmed" | "cancelled";
  version: number;
};
export type SharedGroup = {
  id: string;
  owner_id: string;
  name: string;
  archived: boolean;
  members: SharedMember[];
  expenses: SharedExpense[];
  settlements: SharedSettlement[];
};
export function equalShares(amount: string, members: string[]) {
  const ids = [...members].sort();
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    D(amount).lte(0) ||
    D(amount).decimalPlaces() > 2
  )
    throw new Error("Indica un importe positivo y participantes distintos.");
  const cents = D(amount).mul(100),
    base = cents.div(ids.length).floor(),
    remainder = cents.minus(base.mul(ids.length)).toNumber();
  return ids.map((user_id, i) => ({
    user_id,
    amount: base
      .plus(i < remainder ? 1 : 0)
      .div(100)
      .toFixed(2),
  }));
}
export function sharedBalances(group: SharedGroup) {
  const balances = Object.fromEntries(
    group.members.map((m) => [m.user_id, D(0)]),
  );
  for (const expense of group.expenses.filter((e) => !e.voided)) {
    balances[expense.paid_by] = balances[expense.paid_by].plus(expense.amount);
    for (const share of expense.shares)
      balances[share.user_id] = balances[share.user_id].minus(share.amount);
  }
  for (const payment of group.settlements.filter(
    (s) => s.status === "confirmed",
  )) {
    balances[payment.from_id] = balances[payment.from_id].plus(payment.amount);
    balances[payment.to_id] = balances[payment.to_id].minus(payment.amount);
  }
  return balances;
}
