import { describe, it, expect } from "vitest";
import {
  balances,
  D,
  inventory,
  report,
  monthRange,
  nextDue,
  decimal,
  csv,
  localDay,
} from "../src/lib/finance";
import { applyCommand } from "../src/lib/commands";
import { emptyState, newMovement, uid } from "../src/lib/demo";
import { selectAds, type Ad } from "../src/lib/p2p";
import {
  quoteDefaults,
  type FinanceState,
  type Movement,
} from "../src/lib/types";
export function fixture(): FinanceState {
  const s = emptyState();
  s.profile = { ...s.profile, cutoff: "2026-01-01", onboarded: true };
  s.accounts = [
    {
      id: uid(),
      name: "Banco A",
      type: "bank",
      bank_method: "BANK",
      opening_balance: "10000",
      archived: false,
      version: 1,
    },
    {
      id: uid(),
      name: "Banco B",
      type: "bank",
      bank_method: "BANK",
      opening_balance: "500",
      archived: false,
      version: 1,
    },
  ];
  return s;
}
export function move(
  s: FinanceState,
  kind: Movement["kind"],
  bob: string | null,
  q = "0",
  day = "01",
): Movement {
  return {
    ...newMovement(kind),
    account_id: s.accounts[0].id,
    amount_bob: bob,
    usdt_quantity: q,
    category_id: ["expense", "income"].includes(kind)
      ? s.categories.find((c) => c.type === kind)!.id
      : null,
    occurred_at: `2026-01-${day}T12:00:00-04:00`,
    history_only: kind === "opening",
  };
}
describe("motor financiero", () => {
  it("calcula el ejemplo FIFO y conserva el costo restante", () => {
    const s = fixture();
    s.movements = [
      move(s, "buy", "700", "100", "01"),
      move(s, "buy", "900", "100", "02"),
      move(s, "sell", "1200", "120", "03"),
    ];
    const i = inventory(s.movements);
    expect(D(i.sales[0].profit).toFixed(2)).toBe("320.00");
    expect(i.quantity).toBe("80");
    expect(D(i.known_cost).toFixed(2)).toBe("720.00");
    expect(D(i.quantity).mul("9.5").minus(i.known_cost).toFixed(2)).toBe(
      "40.00",
    );
  });
  it("compra y transferencia no inflan ingresos ni gastos", () => {
    const s = fixture();
    s.movements = [
      move(s, "income", "1000", "0", "01"),
      move(s, "expense", "100", "0", "02"),
      move(s, "buy", "700", "100", "03"),
      {
        ...move(s, "transfer", "50", "0", "04"),
        destination_id: s.accounts[1].id,
      },
    ];
    const r = report(s, "2026-01-01", "2026-01-31"),
      b = balances(s);
    expect(r.income).toBe("1000");
    expect(r.expense).toBe("100");
    expect(b[s.accounts[0].id]).toBe("10150");
    expect(b[s.accounts[1].id]).toBe("550");
  });
  it("incluye comisiones BOB y USDT sin perder precisión", () => {
    const s = fixture();
    s.movements = [
      { ...move(s, "buy", "693", "100"), fee_bob: "7", fee_usdt: "1" },
      { ...move(s, "sell", "800", "79", "02"), fee_bob: "10", fee_usdt: "1" },
    ];
    const i = inventory(s.movements);
    expect(i.quantity).toBe("19");
    expect(D(i.sales[0].profit).toFixed(2)).toBe("224.34");
    expect(balances(s)[s.accounts[0].id]).toBe("10090");
  });
  it("historial inicial reconstruye USDT sin descontar del banco", () => {
    const s = fixture();
    s.movements = [{ ...move(s, "buy", "700", "100"), history_only: true }];
    expect(balances(s)[s.accounts[0].id]).toBe("10000");
    expect(inventory(s.movements).quantity).toBe("100");
  });
  it("no inventa ganancia cuando falta costo", () => {
    const s = fixture();
    s.movements = [
      move(s, "opening", null, "100"),
      move(s, "sell", "500", "50", "02"),
    ];
    const i = inventory(s.movements);
    expect(i.sales[0].profit).toBeNull();
    expect(i.sales[0].unknown_quantity).toBe("50");
    expect(i.unknown_quantity).toBe("50");
  });
  it("bloquea ventas que usan ahorro reservado, sin mutar el estado", () => {
    const s = fixture();
    s.movements = [move(s, "buy", "700", "100")];
    s.goals = [
      {
        id: uid(),
        name: "Emergencia",
        target_amount: "100",
        target_currency: "USDT",
        reserved_usdt: "80",
        due_date: null,
        archived: false,
        version: 1,
      },
    ];
    const m = move(s, "sell", "500", "50", "02");
    expect(() =>
      applyCommand(s, { id: m.id, type: "movement", payload: m }),
    ).toThrow("Libera");
    expect(s.movements).toHaveLength(1);
  });
  it("una corrección histórica recalcula el resultado", () => {
    const s = fixture();
    s.movements = [
      move(s, "buy", "700", "100"),
      move(s, "sell", "1000", "100", "02"),
    ];
    const edited = { ...s.movements[0], amount_bob: "800" };
    const next = applyCommand(s, {
      id: edited.id,
      type: "movement",
      payload: edited,
      expected_version: 1,
    });
    expect(D(inventory(next.movements).sales[0].profit).toFixed(2)).toBe(
      "200.00",
    );
    expect(s.movements[0].amount_bob).toBe("700");
  });
  it("anular una compra ya consumida falla y conserva los datos", () => {
    const s = fixture();
    s.movements = [
      move(s, "buy", "700", "100"),
      move(s, "sell", "500", "50", "02"),
    ];
    expect(() =>
      applyCommand(s, {
        id: s.movements[0].id,
        type: "void",
        payload: {},
        expected_version: 1,
      }),
    ).toThrow("suficientes");
    expect(s.movements[0].voided).toBe(false);
  });
  it("protege edición concurrente y confirmación recurrente duplicada", () => {
    const s = fixture(),
      m = { ...move(s, "expense", "100"), recurring_key: "gym:2026-01-01" };
    s.movements = [m];
    expect(() =>
      applyCommand(s, {
        id: m.id,
        type: "movement",
        payload: m,
        expected_version: 2,
      }),
    ).toThrow("otro dispositivo");
    const duplicate = { ...m, id: uid() };
    expect(() =>
      applyCommand(s, {
        id: duplicate.id,
        type: "movement",
        payload: duplicate,
      }),
    ).toThrow("ya fue confirmado");
  });
  it("repite un envío de creación una sola vez", () => {
    const s = fixture(),
      m = move(s, "expense", "10"),
      c = { id: m.id, type: "movement" as const, payload: m };
    const next = applyCommand(applyCommand(s, c), c);
    expect(next.movements).toHaveLength(1);
  });
  it("usa fechas de La Paz y conserva ancla de fin de mes", () => {
    expect(localDay("2026-02-01T02:30:00Z")).toBe("2026-01-31");
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(nextDue("2026-01-31", "monthly", 31)).toBe("2026-02-28");
    expect(nextDue("2026-02-28", "monthly", 31)).toBe("2026-03-31");
  });
  it("acepta coma decimal y evita fórmulas en CSV", () => {
    expect(decimal("12,50")).toBe("12.5");
    const s = fixture(),
      m = { ...move(s, "expense", "10"), note: '=HYPERLINK("malicioso")' };
    expect(csv(s, [m])).toContain("'=HYPERLINK");
  });
});
describe("referencia P2P", () => {
  const ad = (name: string, price: string, override: Partial<Ad> = {}): Ad => ({
    adNo: name,
    price,
    minTransAmount: "100",
    maxTransAmount: "10000",
    tradableAmount: "1000",
    tradeMethods: ["BANK"],
    advertiser: {
      nickName: name,
      userType: "merchant",
      monthOrderCount: 200,
      monthFinishRate: 0.99,
      positiveRate: 0.99,
    },
    ...override,
  });
  it("excluye una oferta alta con un límite incompatible y calcula mediana", () => {
    const ads = [
      ad("outlier", "13", { maxTransAmount: "170" }),
      ad("A", "9.6"),
      ad("B", "9.5"),
      ad("C", "9.4"),
    ];
    expect(selectAds(ads, quoteDefaults)).toEqual({
      price: "9.50000000",
      count: 3,
    });
  });
  it("exige tres comerciantes distintos y respeta el banco", () => {
    expect(
      selectAds([ad("A", "10"), ad("A", "9"), ad("B", "8")], quoteDefaults)
        .price,
    ).toBeNull();
    expect(
      selectAds([ad("A", "10"), ad("B", "9"), ad("C", "8")], {
        ...quoteDefaults,
        banks: ["OtherBank"],
      }).price,
    ).toBeNull();
  });
});
