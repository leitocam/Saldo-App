export type DecimalString = string;
export type Kind =
  | "expense"
  | "income"
  | "transfer"
  | "buy"
  | "sell"
  | "opening"
  | "adjustment";
export type Account = {
  id: string;
  name: string;
  bank_method: string;
  type: "bank" | "cash";
  opening_balance: string;
  archived: boolean;
  version: number;
};
export type Category = {
  id: string;
  name: string;
  type: "expense" | "income";
  icon: string;
  color: string;
  favorite: boolean;
  position: number;
  archived: boolean;
  version: number;
};
export type Movement = {
  id: string;
  kind: Kind;
  account_id: string | null;
  destination_id: string | null;
  category_id: string | null;
  amount_bob: string | null;
  usdt_quantity: string;
  fee_bob: string;
  fee_usdt: string;
  occurred_at: string;
  note: string;
  history_only: boolean;
  voided: boolean;
  version: number;
  recurring_key: string | null;
};
export type Goal = {
  id: string;
  name: string;
  target_amount: string;
  target_currency: "BOB" | "USDT";
  reserved_usdt: string;
  due_date: string | null;
  archived: boolean;
  version: number;
};
export type Budget = {
  id: string;
  category_id: string;
  month: string;
  amount: string;
  version: number;
};
export type Recurring = {
  id: string;
  name: string;
  amount: string;
  category_id: string;
  account_id: string;
  frequency: "monthly" | "weekly" | "yearly";
  next_date: string;
  anchor_day: number;
  archived: boolean;
  version: number;
};
export type QuoteSettings = {
  banks: string[];
  quantity: string;
  min_orders: number;
  min_completion: number;
  min_positive: number;
};
export type Quote = {
  id: string;
  price: string;
  observed_at: string;
  source: "binance" | "manual";
  sample_count: number;
  quantity: string;
  banks: string[];
};
export type Profile = {
  display_name: string;
  cutoff: string;
  onboarded: boolean;
  quote_settings: QuoteSettings;
  version: number;
};
export type FinanceState = {
  profile: Profile;
  accounts: Account[];
  categories: Category[];
  movements: Movement[];
  goals: Goal[];
  budgets: Budget[];
  recurring: Recurring[];
  quotes: Quote[];
};
export type Entity =
  | "account"
  | "category"
  | "goal"
  | "budget"
  | "recurring"
  | "profile"
  | "quote";
export type Command = {
  id: string;
  type: "movement" | "void" | "entity" | "bootstrap";
  entity?: Entity;
  payload: Record<string, unknown>;
  expected_version?: number;
};
export type Pending = {
  command: Command;
  status: "pending" | "failed";
  error?: string;
};
export type Lot = {
  id: string;
  date: string;
  remaining: string;
  unit_cost: string | null;
  original_quantity: string;
};
export type SaleResult = {
  id: string;
  cost: string;
  unknown_quantity: string;
  profit: string | null;
  quantity: string;
};
export type Inventory = {
  quantity: string;
  known_cost: string;
  unknown_quantity: string;
  lots: Lot[];
  sales: SaleResult[];
};
export const quoteDefaults: QuoteSettings = {
  banks: [],
  quantity: "100",
  min_orders: 100,
  min_completion: 0.95,
  min_positive: 0.98,
};
