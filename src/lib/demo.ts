import { atDay, monthNow, today, previousMonth } from "./finance";
import { quoteDefaults } from "./types";
import type { FinanceState, Movement, Category } from "./types";
export const uid = () => crypto.randomUUID();
const aid = (n: number) =>
  `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const initialCategories = (): Category[] =>
  [
    ["Gym", "Dumbbell", "#B8A6D9"],
    ["Comida — restaurantes", "Utensils", "#E8B78E"],
    ["Alimentación — supermercado", "ShoppingBasket", "#83D6AF"],
    ["Recreativo", "Gamepad2", "#9EAEEE"],
    ["Servicios", "Zap", "#E6C478"],
    ["Transporte", "Car", "#A7C4D5"],
    ["Salud", "HeartPulse", "#F29B9B"],
    ["Hogar", "House", "#BDADA1"],
    ["Otros", "Shapes", "#B5B7BC"],
    ["Sueldo", "BriefcaseBusiness", "#83D6AF"],
    ["Trabajo independiente", "Laptop", "#A7C4D5"],
    ["Otros ingresos", "CircleDollarSign", "#83D6AF"],
  ].map(([name, icon, color], i) => ({
    id: aid(20 + i),
    name,
    icon,
    color,
    type: i < 9 ? "expense" : "income",
    favorite: i < 6,
    position: i,
    archived: false,
    version: 1,
  }));
export function emptyState(): FinanceState {
  return {
    profile: {
      display_name: "Mi espacio",
      cutoff: today(),
      onboarded: false,
      quote_settings: { ...quoteDefaults },
      version: 1,
    },
    accounts: [],
    categories: initialCategories(),
    movements: [],
    goals: [],
    budgets: [],
    recurring: [],
    quotes: [],
  };
}
export function newMovement(kind: Movement["kind"] = "expense"): Movement {
  return {
    id: uid(),
    kind,
    account_id: null,
    destination_id: null,
    category_id: null,
    amount_bob: "0",
    usdt_quantity: "0",
    fee_bob: "0",
    fee_usdt: "0",
    occurred_at: atDay(today()),
    note: "",
    history_only: false,
    voided: false,
    version: 1,
    recurring_key: null,
  };
}
export function demoState(): FinanceState {
  const s = emptyState(),
    month = monthNow(),
    before = previousMonth(month),
    older = previousMonth(before),
    oldest = previousMonth(older);
  s.profile = {
    ...s.profile,
    display_name: "Leo",
    cutoff: `${oldest}-01`,
    onboarded: true,
  };
  s.accounts = [
    {
      id: aid(1),
      name: "Banco Nacional de Bolivia",
      bank_method: "BancoDeBolivia",
      type: "bank",
      opening_balance: "12800",
      archived: false,
      version: 1,
    },
    {
      id: aid(2),
      name: "Banco Unión",
      bank_method: "BancoUnion",
      type: "bank",
      opening_balance: "9500",
      archived: false,
      version: 1,
    },
    {
      id: aid(3),
      name: "Efectivo",
      bank_method: "",
      type: "cash",
      opening_balance: "420",
      archived: false,
      version: 1,
    },
  ];
  const add = (
    kind: Movement["kind"],
    amount: string,
    date: string,
    cat: number,
    account = aid(1),
    note = "",
    quantity = "0",
    historical = false,
  ) =>
    s.movements.push({
      ...newMovement(kind),
      id: aid(100 + s.movements.length),
      account_id: account,
      amount_bob: amount,
      category_id: ["expense", "income"].includes(kind) ? aid(20 + cat) : null,
      occurred_at: atDay(date),
      note,
      usdt_quantity: quantity,
      history_only: historical,
    });
  add(
    "buy",
    "3950",
    `${oldest}-01`,
    0,
    aid(1),
    "Primera compra · historial inicial",
    "500",
    true,
  );
  add("buy", "2490", `${older}-10`, 0, aid(2), "Aporte mensual", "300");
  add("buy", "1290", `${before}-15`, 0, aid(1), "Ahorro de septiembre", "150");
  for (const [m, inc, food, other] of [
    [oldest, "8500", "2180", "1640"],
    [older, "9200", "2450", "1950"],
    [before, "10800", "2690", "2010"],
  ] as string[][]) {
    add("income", inc, `${m}-03`, 9, aid(1), "Sueldo");
    add("expense", food, `${m}-08`, 2, aid(1), "Compras del mes");
    add("expense", other, `${m}-18`, 3, aid(2), "Salidas y actividades");
  }
  const day = Number(today().slice(8)),
    d = (n: number) => `${month}-${String(Math.min(day, n)).padStart(2, "0")}`;
  add("income", "12500", d(3), 9, aid(1), "Sueldo · este mes");
  add("income", "1800", d(6), 10, aid(2), "Proyecto freelance");
  add("expense", "280", d(5), 0, aid(1), "Mensualidad del gym");
  add("expense", "1248.50", d(9), 2, aid(1), "Compras de la semana");
  add("expense", "390", d(12), 4, aid(2), "Internet y electricidad");
  add("expense", "680", d(16), 3, aid(2), "Fin de semana");
  add("expense", "85", d(19), 5, aid(3), "Taxi");
  add("expense", "186", d(23), 1, aid(1), "Almuerzo con amigos");
  add("expense", "342.80", d(25), 2, aid(1), "Supermercado");
  add("expense", "75", d(27), 1, aid(3), "Café y desayuno");
  s.goals = [
    {
      id: aid(50),
      name: "Fondo de emergencia",
      target_amount: "1000",
      target_currency: "USDT",
      reserved_usdt: "450",
      due_date: `${Number(month.slice(0, 4)) + 1}-03-01`,
      archived: false,
      version: 1,
    },
    {
      id: aid(51),
      name: "Mi próximo viaje",
      target_amount: "600",
      target_currency: "USDT",
      reserved_usdt: "200",
      due_date: null,
      archived: false,
      version: 1,
    },
  ];
  s.budgets = [
    { id: aid(60), category_id: aid(22), month, amount: "2200", version: 1 },
    { id: aid(61), category_id: aid(21), month, amount: "1000", version: 1 },
    { id: aid(62), category_id: aid(23), month, amount: "800", version: 1 },
  ];
  s.recurring = [
    {
      id: aid(70),
      name: "Mensualidad del gym",
      amount: "280",
      category_id: aid(20),
      account_id: aid(1),
      frequency: "monthly",
      next_date: today(),
      anchor_day: 5,
      archived: false,
      version: 1,
    },
    {
      id: aid(71),
      name: "Internet de casa",
      amount: "210",
      category_id: aid(24),
      account_id: aid(2),
      frequency: "monthly",
      next_date: `${month}-${String(Math.min(28, day + 2)).padStart(2, "0")}`,
      anchor_day: 28,
      archived: false,
      version: 1,
    },
  ];
  s.quotes = [
    {
      id: aid(80),
      price: "9.45",
      observed_at: new Date().toISOString(),
      source: "manual",
      sample_count: 0,
      quantity: "100",
      banks: [],
    },
  ];
  return s;
}
