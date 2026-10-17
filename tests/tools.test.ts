import { describe, it, expect } from "vitest";
import { emptyState, newMovement, uid } from "../src/lib/demo";
import { applyCommand } from "../src/lib/commands";
import { D, atDay, balances, inventory, report } from "../src/lib/finance";
import {
  createBackup,
  prepareRestore,
  validateSnapshot,
} from "../src/lib/backup";
import {
  monthlyAvailable,
  planningCommand,
  planningState,
  debtTotals,
} from "../src/lib/planning";
import { parseCsv, defaultMapping, previewCsv } from "../src/lib/csv-import";
import {
  equalShares,
  sharedBalances,
  type SharedGroup,
} from "../src/lib/shared";
import type { Debt, FinanceState, Movement } from "../src/lib/types";

function fixture() {
  const s = emptyState();
  s.profile = { ...s.profile, onboarded: true, cutoff: "2026-01-01" };
  s.accounts = [
    {
      id: uid(),
      name: "Banco A",
      bank_method: "BANK",
      type: "bank",
      opening_balance: "1000",
      archived: false,
      version: 1,
    },
  ];
  s.movements = [
    {
      ...newMovement("opening"),
      amount_bob: "700",
      usdt_quantity: "100",
      occurred_at: atDay("2026-01-01"),
      history_only: true,
    },
  ];
  return s;
}
function card(s: FinanceState): Movement {
  return {
    ...newMovement("card"),
    amount_bob: "100",
    card_amount: "100",
    card_currency: "BOB",
    usdt_quantity: "10",
    category_id: s.categories[0].id,
    occurred_at: atDay("2026-01-02"),
    note: "Compra",
  };
}
describe("planificación y archivo", () => {
  it("disponible mensual reserva todas las recurrencias pendientes sin contar ingresos futuros ni cripto", () => {
    const s = fixture();
    s.recurring = [
      {
        id: uid(),
        name: "Gym",
        amount: "100",
        category_id: s.categories[0].id,
        account_id: s.accounts[0].id,
        frequency: "weekly",
        next_date: "2026-01-25",
        anchor_day: 25,
        archived: false,
        version: 1,
      },
    ];
    const p = monthlyAvailable(s, "2026-01-26");
    expect(p.committed.toFixed()).toBe("100");
    expect(p.free.toFixed()).toBe("900");
    expect(p.daily.toFixed()).toBe("150");
    expect(p.availableUsdt.toFixed()).toBe("100");
    expect(p.payments[0].overdue).toBe(true);
  });
  it("préstamo y cobro parcial cambian banco y deuda sin inflar ingresos o consumo", () => {
    const s = fixture(),
      m = {
        ...newMovement("adjustment"),
        account_id: s.accounts[0].id,
        amount_bob: "-200",
        occurred_at: atDay("2026-01-02"),
        note: "Préstamo",
      };
    const debt: Debt = {
      id: uid(),
      name: "Amigo",
      direction: "receivable",
      principal: "200",
      note: "",
      archived: false,
      due_date: null,
      opening_movement_id: m.id,
      payments: [],
    };
    const next = applyCommand(s, {
      id: uid(),
      type: "batch",
      payload: {
        commands: [
          { id: m.id, type: "movement", payload: m },
          planningCommand(s, { ...planningState(s), debts: [debt] }),
        ],
      },
    });
    expect(balances(next)[s.accounts[0].id]).toBe("800");
    expect(debtTotals(next).receivable.toFixed()).toBe("200");
    expect(report(next, "2026-01-01", "2026-01-31").expense).toBe("0");
    expect(() =>
      applyCommand(next, {
        id: m.id,
        type: "void",
        payload: {},
        expected_version: 1,
      }),
    ).toThrow("deuda");
  });
  it("devolución en USDC reduce gasto sin fabricar USDT ni descontar de bancos", () => {
    const s = fixture(),
      m = card(s);
    s.movements.push(m);
    const refund = {
      ...newMovement("refund"),
      asset: "USDC" as const,
      parent_id: m.id,
      category_id: m.category_id,
      amount_bob: "40",
      usdt_quantity: "5",
      occurred_at: atDay("2026-01-03"),
      note: "Devolución parcial",
    };
    const next = applyCommand(s, {
      id: refund.id,
      type: "movement",
      payload: refund,
    });
    expect(inventory(next.movements).quantity).toBe("90");
    expect(inventory(next.movements, "USDC").quantity).toBe("5");
    expect(report(next, "2026-01-01", "2026-01-31").expense).toBe("60");
    expect(balances(next)[s.accounts[0].id]).toBe("1000");
    const excessive = { ...refund, id: uid(), amount_bob: "80" };
    expect(() =>
      applyCommand(next, {
        id: excessive.id,
        type: "movement",
        payload: excessive,
      }),
    ).toThrow("devoluciones superan");
  });
  it("conciliación rechaza un saldo cambiado y no inventa ganancias de ajuste", () => {
    const s = fixture();
    const m = {
      ...newMovement("crypto_out"),
      amount_bob: null,
      usdt_quantity: "5",
      occurred_at: atDay("2026-01-03"),
      note: "Diferencia de saldo",
    };
    const command = {
      id: uid(),
      type: "batch" as const,
      payload: {
        expected_inventory: { USDT: "99" },
        commands: [{ id: m.id, type: "movement", payload: m }],
      },
    };
    expect(() => applyCommand(s, command)).toThrow("saldo cambió");
    command.payload.expected_inventory.USDT = "100";
    const next = applyCommand(s, command);
    expect(inventory(next.movements).quantity).toBe("95");
    expect(inventory(next.movements).sales).toHaveLength(0);
  });
  it("respaldo restaura anulados y omite registros idénticos", async () => {
    const s = fixture();
    s.movements.push({
      ...newMovement("expense"),
      account_id: s.accounts[0].id,
      category_id: s.categories[0].id,
      amount_bob: "30",
      occurred_at: atDay("2026-01-03"),
      voided: true,
    });
    const backup = createBackup(s, "local");
    const target = emptyState();
    const plan = await prepareRestore(target, backup, "local");
    expect(plan.added).toBeGreaterThan(0);
    expect(plan.merged.movements.at(-1)?.voided).toBe(true);
    expect(balances(plan.merged)[s.accounts[0].id]).toBe("1000");
    const duplicate = await prepareRestore(plan.merged, backup, "local");
    expect(duplicate.added).toBe(0);
  });
  it("un respaldo portátil remapea relaciones de forma estable", async () => {
    const s = fixture(),
      backup = createBackup(s, "owner-A");
    const first = await prepareRestore(emptyState(), backup, "owner-B"),
      second = await prepareRestore(emptyState(), backup, "owner-B");
    expect(first.remapped).toBe(true);
    expect(first.merged.accounts[0].id).not.toBe(s.accounts[0].id);
    expect(first.merged.accounts[0].id).toBe(second.merged.accounts[0].id);
    expect(first.merged.movements[0].id).toBe(second.merged.movements[0].id);
    validateSnapshot(first.merged);
  });
  it("un respaldo nunca sobrescribe una cuenta modificada", async () => {
    const s = fixture(),
      backup = createBackup(s, "local");
    const current = structuredClone(s);
    current.accounts[0].name = "Nombre nuevo";
    await expect(prepareRestore(current, backup, "local")).rejects.toThrow(
      "Conflicto",
    );
    expect(current.accounts[0].name).toBe("Nombre nuevo");
  });
  it("CSV con comillas y saltos de línea conserva notas y detecta duplicados", () => {
    const s = fixture();
    const parsed = parseCsv(
      'Fecha;BOB;Descripción\r\n2026-01-02;25;"Compra; con detalle\ny dos líneas"\r\n2026-01-02;25;"Compra; con detalle\ny dos líneas"',
    );
    const mapping = defaultMapping(parsed.headers);
    const preview = previewCsv(s, parsed, mapping, {
      account: s.accounts[0].id,
      category: s.categories[0].id,
      kind: "expense",
    });
    expect(preview.errors).toEqual([]);
    expect(preview.movements).toHaveLength(1);
    expect(preview.duplicates).toBe(1);
    expect(preview.movements[0].note).toContain("\ny dos líneas");
  });
  it("rechaza JSON inconsistente y CSV incompleto sin modificar el espacio", () => {
    const s = fixture();
    expect(() =>
      validateSnapshot({
        ...s,
        movements: [...s.movements, { ...card(s), usdt_quantity: "1000" }],
      }),
    ).toThrow();
    expect(() => parseCsv('Fecha;BOB\n2026-01-01;"25')).toThrow("sin cerrar");
    expect(s.movements).toHaveLength(1);
  });
});
describe("repartos compartidos exactos", () => {
  it("reparte centavos sin perder dinero", () => {
    const shares = equalShares("100.01", ["b", "a", "c"]);
    expect(shares).toEqual([
      { user_id: "a", amount: "33.34" },
      { user_id: "b", amount: "33.34" },
      { user_id: "c", amount: "33.33" },
    ]);
    expect(shares.reduce((sum, s) => sum.plus(s.amount), D(0)).toFixed()).toBe(
      "100.01",
    );
  });
  it("solo liquidaciones confirmadas cambian obligaciones y la suma permanece en cero", () => {
    const g: SharedGroup = {
      id: uid(),
      owner_id: "a",
      name: "Pareja",
      archived: false,
      members: [
        { user_id: "a", display_name: "A" },
        { user_id: "b", display_name: "B" },
      ],
      expenses: [
        {
          id: uid(),
          paid_by: "a",
          created_by: "a",
          amount: "100",
          shares: equalShares("100", ["a", "b"]),
          date: "2026-01-01",
          note: "Comida",
          voided: false,
          version: 1,
        },
      ],
      settlements: [
        {
          id: uid(),
          from_id: "b",
          to_id: "a",
          amount: "50",
          date: "2026-01-02",
          status: "pending",
          version: 1,
        },
      ],
    };
    expect(sharedBalances(g).a.toFixed()).toBe("50");
    g.settlements[0].status = "confirmed";
    expect(sharedBalances(g).a.toFixed()).toBe("0");
    expect(sharedBalances(g).b.toFixed()).toBe("0");
  });
});
