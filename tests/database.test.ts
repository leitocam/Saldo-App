import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect, describe } from "vitest";
import { emptyState, newMovement, uid } from "../src/lib/demo";
import type { Command, FinanceState } from "../src/lib/types";
import { D, inventory } from "../src/lib/finance";
let db: PGlite;
const owner = uid(),
  other = uid();
let s: FinanceState;
const execute = async (c: Command) =>
  db.query("select public.apply_finance_command($1::jsonb) result", [
    JSON.stringify(c),
  ]);
const login = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
};
const movement = (
  kind: "buy" | "sell" | "transfer" | "expense",
  amount: string,
  quantity = "0",
  date = "01",
) => ({
  ...newMovement(kind),
  account_id: s.accounts[0].id,
  amount_bob: amount,
  usdt_quantity: quantity,
  occurred_at: `2026-01-${date}T12:00:00-04:00`,
  category_id: kind === "expense" ? s.categories[0].id : null,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;`,
  );
  await db.query("insert into auth.users values($1),($2)", [owner, other]);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  await login(owner);
  s = emptyState();
  s.profile = { ...s.profile, cutoff: "2026-01-01", onboarded: true };
  s.categories = s.categories.map((c) => ({ ...c, id: uid() }));
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
  await execute({
    id: uid(),
    type: "bootstrap",
    payload: s as unknown as Record<string, unknown>,
  });
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe.sequential("Postgres real en WASM: comandos y seguridad", () => {
  it("confirma recurrente y próxima fecha de manera atómica, incluso con reintento", async () => {
    const recurring = {
      id: uid(),
      name: "Gym automático",
      amount: "100",
      category_id: s.categories[0].id,
      account_id: s.accounts[0].id,
      frequency: "monthly",
      next_date: "2026-01-31",
      anchor_day: 31,
      archived: false,
      version: 1,
    };
    await execute({
      id: recurring.id,
      type: "entity",
      entity: "recurring",
      payload: recurring,
    });
    const m = {
      ...movement("expense", "100", "0", "31"),
      recurring_key: `${recurring.id}:2026-01-31`,
    };
    const command = { id: m.id, type: "movement" as const, payload: m };
    await execute(command);
    await execute(command);
    const result = await db.query<{ next_date: string; version: number }>(
      "select next_date::text,version from public.recurring where id=$1",
      [recurring.id],
    );
    expect(result.rows[0]).toEqual({ next_date: "2026-02-28", version: 2 });
    const duplicate = { ...m, id: uid() };
    await expect(
      execute({ id: duplicate.id, type: "movement", payload: duplicate }),
    ).rejects.toThrow();
    const count = await db.query<{ count: number }>(
      "select count(*)::int count from public.movements where recurring_key=$1",
      [m.recurring_key],
    );
    expect(count.rows[0].count).toBe(1);
  });
  it("rechaza escrituras directas fuera del límite atómico", async () => {
    await expect(
      db.query("update public.accounts set opening_balance=0"),
    ).rejects.toThrow("permission denied");
  });
  it("confirma transferencia una vez y crea ambas entradas", async () => {
    const m = {
      ...movement("transfer", "100"),
      destination_id: s.accounts[1].id,
    };
    const c = { id: m.id, type: "movement" as const, payload: m };
    await execute(c);
    await execute(c);
    const r = await db.query<{ count: number; sum: string }>(
      "select count(*)::int count,sum(amount)::text sum from public.account_entries where movement_id=$1",
      [m.id],
    );
    expect(r.rows[0]).toEqual({ count: 2, sum: "0.00" });
  });
  it("produce el resultado FIFO acordado y coincide con TypeScript", async () => {
    const moves = [
      movement("buy", "700", "100", "02"),
      movement("buy", "900", "100", "03"),
      movement("sell", "1200", "120", "04"),
    ];
    for (const m of moves)
      await execute({ id: m.id, type: "movement", payload: m });
    const r = await db.query<{ profit: string }>(
      "select realized_profit::text profit from public.movements where id=$1",
      [moves[2].id],
    );
    expect(D(r.rows[0].profit).toFixed(2)).toBe("320.00");
    expect(D(inventory(moves).sales[0].profit).toFixed(2)).toBe("320.00");
    const lot = await db.query<{ quantity: string }>(
      "select sum(remaining)::text quantity from public.usdt_lots",
    );
    expect(D(lot.rows[0].quantity).toFixed()).toBe("80");
    s.movements.push(...moves);
  });
  it("revierte toda la transacción si se intenta vender ahorro reservado", async () => {
    const goal = {
      id: uid(),
      name: "Emergencia",
      target_amount: "100",
      target_currency: "USDT",
      reserved_usdt: "60",
      due_date: null,
      archived: false,
      version: 1,
    };
    await execute({
      id: goal.id,
      type: "entity",
      entity: "goal",
      payload: goal,
    });
    const m = movement("sell", "500", "50", "05");
    await expect(
      execute({ id: m.id, type: "movement", payload: m }),
    ).rejects.toThrow("Libera");
    expect(
      (await db.query("select id from public.movements where id=$1", [m.id]))
        .rows,
    ).toHaveLength(0);
    expect(
      D(
        (
          await db.query<{ quantity: string }>(
            "select sum(remaining)::text quantity from public.usdt_lots",
          )
        ).rows[0].quantity,
      ).toFixed(),
    ).toBe("80");
  });
  it("mantiene decimales como cadenas en la interfaz de lectura", async () => {
    const result = await db.query<{ state: FinanceState }>(
      "select public.read_finance_state() state",
    );
    expect(typeof result.rows[0].state.accounts[0].opening_balance).toBe(
      "string",
    );
    expect(typeof result.rows[0].state.movements[0].amount_bob).toBe("string");
  });
  it("historial inicial no genera entradas bancarias", async () => {
    const m = { ...movement("buy", "700", "100"), history_only: true };
    await execute({ id: m.id, type: "movement", payload: m });
    expect(
      (
        await db.query(
          "select id from public.account_entries where movement_id=$1",
          [m.id],
        )
      ).rows,
    ).toHaveLength(0);
  });
  it("no permite ediciones con una versión antigua", async () => {
    const m = s.movements[0];
    await expect(
      execute({ id: m.id, type: "movement", payload: m, expected_version: 9 }),
    ).rejects.toThrow("conflicto");
  });
  it("aísla datos y referencias entre usuarios incluso con acceso al RPC", async () => {
    await login(other);
    expect((await db.query("select * from public.accounts")).rows).toHaveLength(
      0,
    );
    expect(
      (await db.query("select * from public.usdt_lots")).rows,
    ).toHaveLength(0);
    await expect(
      execute({
        id: s.accounts[0].id,
        type: "entity",
        entity: "account",
        payload: s.accounts[0],
        expected_version: 1,
      }),
    ).rejects.toThrow("no te pertenece");
    const otherState = emptyState();
    otherState.profile = {
      ...otherState.profile,
      cutoff: "2026-01-01",
      onboarded: true,
    };
    otherState.categories = otherState.categories.map((c) => ({
      ...c,
      id: uid(),
    }));
    otherState.accounts = [
      { ...s.accounts[0], id: uid(), name: "Banco del otro usuario" },
    ];
    await execute({
      id: uid(),
      type: "bootstrap",
      payload: otherState as unknown as Record<string, unknown>,
    });
    await expect(
      execute({
        id: uid(),
        type: "movement",
        payload: { ...movement("expense", "100"), id: uid() },
      }),
    ).rejects.toThrow();
    await login(owner);
    expect((await db.query("select * from public.accounts")).rows).toHaveLength(
      2,
    );
  });
});
