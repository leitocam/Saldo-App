import { describe, it, expect, vi } from "vitest";
import { deliver, rebase } from "../src/lib/sync";
import { emptyState, newMovement, uid } from "../src/lib/demo";
import { applyCommand } from "../src/lib/commands";
import type { Command, FinanceState } from "../src/lib/types";
function fixture() {
  const s = emptyState();
  s.profile = { ...s.profile, cutoff: "2026-01-01", onboarded: true };
  s.accounts = [
    {
      id: uid(),
      name: "Banco",
      type: "bank" as const,
      bank_method: "BANK",
      opening_balance: "1000",
      archived: false,
      version: 1,
    },
  ];
  const m = {
    ...newMovement(),
    account_id: s.accounts[0].id,
    category_id: s.categories[0].id,
    amount_bob: "12.50",
    occurred_at: "2026-01-02T12:00:00-04:00",
  };
  const c: Command = { id: m.id, type: "movement", payload: m };
  return { s, m, c };
}
describe("cola y recuperación de conexión", () => {
  it("recupera correcciones, anulaciones y entidades confirmadas sin marcarlas como rechazadas", () => {
    const { s, m, c } = fixture();
    let state = applyCommand(s, c);
    const edit: Command = {
      ...c,
      payload: { ...m, amount_bob: "20" },
      expected_version: 1,
    };
    state = applyCommand(state, edit);
    expect(
      rebase(state, [{ command: edit, status: "pending" }]).pending[0].status,
    ).toBe("pending");
    const voidCommand: Command = {
      id: m.id,
      type: "void",
      payload: {},
      expected_version: 2,
    };
    state = applyCommand(state, voidCommand);
    expect(
      rebase(state, [{ command: voidCommand, status: "pending" }]).state
        .movements[0].version,
    ).toBe(3);
    const account = { ...s.accounts[0], id: uid(), name: "Otra cuenta" };
    const entity: Command = {
      id: account.id,
      type: "entity",
      entity: "account",
      payload: account,
    };
    state = applyCommand(state, entity);
    state.accounts.find((a) => a.id === account.id)!.opening_balance =
      "1000.00";
    const result = rebase(state, [{ command: entity, status: "pending" }]);
    expect(result.pending[0].status).toBe("pending");
    expect(result.state.accounts).toHaveLength(2);
  });
  it("conserva pendientes cuando la red o el servidor falla", async () => {
    const { c } = fixture();
    const unavailable = vi.fn(
      async () => new Response("{}", { status: 503 }),
    ) as unknown as typeof fetch;
    const disconnected = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await deliver(c, unavailable)).toEqual({ status: "retry" });
    expect(await deliver(c, disconnected)).toEqual({ status: "retry" });
  });
  it("distingue sesión vencida de un registro que necesita revisión", async () => {
    const { c } = fixture();
    expect(
      await deliver(c, async () => new Response("{}", { status: 401 })),
    ).toEqual({ status: "auth" });
    expect(
      await deliver(
        c,
        async () =>
          new Response(JSON.stringify({ error: "Saldo insuficiente" }), {
            status: 400,
          }),
      ),
    ).toEqual({ status: "rejected", error: "Saldo insuficiente" });
  });
  it("recupera una respuesta perdida sin duplicar el movimiento confirmado", () => {
    const { s, m, c } = fixture();
    const confirmed = applyCommand(s, c);
    confirmed.movements = [
      {
        ...m,
        amount_bob: "12.50",
        usdt_quantity: "0.00000000",
        fee_bob: "0.00",
        fee_usdt: "0.00000000",
        occurred_at: "2026-01-02T16:00:00+00:00",
      },
    ];
    const next = rebase(confirmed, [{ command: c, status: "pending" }]);
    expect(next.state.movements).toHaveLength(1);
    expect(next.pending[0].status).toBe("pending");
  });
  it("preserva datos de una operación rechazada después de otra corrección", () => {
    const { s, c } = fixture();
    const confirmed: FinanceState = { ...s, accounts: [] };
    const next = rebase(confirmed, [{ command: c, status: "pending" }]);
    expect(next.state.movements).toHaveLength(0);
    expect(next.pending[0].status).toBe("failed");
    expect(next.pending[0].command.payload.amount_bob).toBe("12.50");
  });
  it("envía ediciones con su versión y el verbo PUT", async () => {
    const { c } = fixture();
    const transport = vi.fn(async () => new Response("{}", { status: 200 }));
    expect(await deliver({ ...c, expected_version: 1 }, transport)).toEqual({
      status: "accepted",
    });
    expect(transport).toHaveBeenCalledWith(
      `/api/movements/${c.id}`,
      expect.objectContaining({ method: "PUT" }),
    );
  });
});
