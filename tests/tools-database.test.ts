import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from "vitest";
import { emptyState, newMovement, uid } from "../src/lib/demo";
import { atDay, D, inventory, report } from "../src/lib/finance";
import { planningState } from "../src/lib/planning";
import { createBackup, prepareRestore } from "../src/lib/backup";
import { equalShares } from "../src/lib/shared";
import type { FinanceState, Command } from "../src/lib/types";
let db: PGlite;
const owner = uid(),
  other = uid(),
  outsider = uid();
let state: FinanceState;
const login = async (id: string) => {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
  await db.exec("set role authenticated");
};
async function call<T>(sql: string, params: unknown[]) {
  await db.exec("savepoint call_guard");
  try {
    const result = await db.query<T>(sql, params);
    await db.exec("release savepoint call_guard");
    return result;
  } catch (e) {
    await db.exec("rollback to savepoint call_guard");
    await db.exec("release savepoint call_guard");
    throw e;
  }
}
const exec = (command: Command) =>
  call("select public.apply_finance_command($1::jsonb)", [
    JSON.stringify(command),
  ]);
const shared = async (command: Record<string, unknown>) =>
  (
    await call<{ result: Record<string, unknown> }>(
      "select public.shared_finance_command($1::jsonb) result",
      [JSON.stringify(command)],
    )
  ).rows[0].result;
const read = async () =>
  (
    await db.query<{ state: FinanceState }>(
      "select public.read_finance_state() state",
    )
  ).rows[0].state;
const card = () => ({
  ...newMovement("card"),
  note: "Compra",
  occurred_at: atDay("2026-01-02"),
  amount_bob: "100",
  card_amount: "100",
  card_currency: "BOB",
  usdt_quantity: "10",
  category_id: state.categories[0].id,
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;",
  );
  await db.query("insert into auth.users values($1),($2),($3)", [
    owner,
    other,
    outsider,
  ]);
  for (const file of readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    await db.exec(readFileSync(`supabase/migrations/${file}`, "utf8"));
  for (const user of [owner, other]) {
    await db.exec("begin");
    await login(user);
    const s = emptyState();
    s.profile = { ...s.profile, onboarded: true, cutoff: "2026-01-01" };
    s.categories = s.categories.map((c) => ({ ...c, id: uid() }));
    s.accounts = [
      {
        id: uid(),
        name: "Banco",
        bank_method: "BANK",
        type: "bank",
        opening_balance: "10000",
        archived: false,
        version: 1,
      },
    ];
    s.movements = [
      {
        ...newMovement("opening"),
        amount_bob: "700",
        usdt_quantity: "100",
        history_only: true,
        occurred_at: atDay("2026-01-01"),
      },
    ];
    await exec({
      id: uid(),
      type: "bootstrap",
      payload: s as unknown as Record<string, unknown>,
    });
    if (user === owner) state = s;
    await db.exec("commit");
    await db.exec("reset role");
  }
}, 30000);
beforeEach(async () => {
  await db.exec("begin");
  await login(owner);
});
afterEach(async () => {
  await db.exec("rollback");
  await db.exec("reset role");
});
afterAll(async () => {
  await db.close();
});

it("aplica deudas y sus asientos juntos; un pago excesivo revierte todo", async () => {
  const m = {
    ...newMovement("adjustment"),
    account_id: state.accounts[0].id,
    amount_bob: "-200",
    note: "Capital prestado",
    occurred_at: atDay("2026-01-02"),
  };
  const p = {
    ...planningState(state),
    debts: [
      {
        id: uid(),
        name: "Amigo",
        direction: "receivable",
        principal: "200",
        note: "",
        due_date: null,
        archived: false,
        opening_movement_id: m.id,
        payments: [],
      },
    ],
  };
  await exec({
    id: uid(),
    type: "batch",
    payload: {
      commands: [
        { id: m.id, type: "movement", payload: m },
        { id: uid(), type: "planning", payload: p },
      ],
    },
  });
  expect((await read()).planning?.debts).toHaveLength(1);
  await expect(
    exec({ id: m.id, type: "void", payload: {}, expected_version: 1 }),
  ).rejects.toThrow("deuda");
  expect((await read()).movements.find((x) => x.id === m.id)?.voided).toBe(
    false,
  );
  const pay = {
    ...newMovement("adjustment"),
    account_id: state.accounts[0].id,
    amount_bob: "300",
    note: "Cobro",
    occurred_at: atDay("2026-01-03"),
  };
  const bad = {
    ...p,
    version: 1,
    debts: [
      {
        ...p.debts[0],
        payments: [
          {
            id: uid(),
            amount: "300",
            date: "2026-01-03",
            account_id: state.accounts[0].id,
            movement_id: pay.id,
          },
        ],
      },
    ],
  };
  await expect(
    exec({
      id: uid(),
      type: "batch",
      payload: {
        commands: [
          { id: pay.id, type: "movement", payload: pay },
          { id: uid(), type: "planning", payload: bad, expected_version: 1 },
        ],
      },
    }),
  ).rejects.toThrow("excesivos");
  expect((await read()).movements.some((x) => x.id === pay.id)).toBe(false);
});
it("devolución USDC respeta FIFO USDT y revierte excesos", async () => {
  const m = card();
  await exec({ id: m.id, type: "movement", payload: m });
  const refund = {
    ...newMovement("refund"),
    asset: "USDC" as const,
    amount_bob: "40",
    usdt_quantity: "5",
    parent_id: m.id,
    category_id: m.category_id,
    note: "Devolución parcial",
    occurred_at: atDay("2026-01-03"),
  };
  await exec({ id: refund.id, type: "movement", payload: refund });
  const s = await read();
  expect(inventory(s.movements).quantity).toBe("90");
  expect(inventory(s.movements, "USDC").quantity).toBe("5");
  expect(report(s, "2026-01-01", "2026-01-31").expense).toBe("60");
  const over = { ...refund, id: uid(), amount_bob: "70" };
  await expect(
    exec({ id: over.id, type: "movement", payload: over }),
  ).rejects.toThrow("superan");
  await expect(
    exec({ id: m.id, type: "void", payload: {}, expected_version: 1 }),
  ).rejects.toThrow("devolución");
});
it("conciliación bloquea un saldo diferente al revisado", async () => {
  const m = {
    ...newMovement("crypto_in"),
    usdt_quantity: "5",
    amount_bob: null,
    note: "Ajuste revisado",
    occurred_at: atDay("2026-01-03"),
  };
  await expect(
    exec({
      id: uid(),
      type: "batch",
      payload: {
        expected_inventory: { USDT: "99" },
        commands: [{ id: m.id, type: "movement", payload: m }],
      },
    }),
  ).rejects.toThrow("saldo cambió");
  await exec({
    id: uid(),
    type: "batch",
    payload: {
      expected_inventory: { USDT: "100" },
      commands: [{ id: m.id, type: "movement", payload: m }],
    },
  });
  expect(inventory((await read()).movements).unknown_quantity).toBe("5");
});
it("restaura un respaldo portable con registros anulados y referencias archivadas", async () => {
  const source = structuredClone(state);
  source.accounts[0].archived = true;
  source.categories[0].archived = true;
  source.budgets = [
    {
      id: uid(),
      category_id: source.categories[0].id,
      month: "2026-01",
      amount: "200",
      version: 1,
    },
  ];
  const m = { ...card(), voided: true };
  source.movements.push(m, {
    ...newMovement("refund"),
    asset: "USDC",
    parent_id: m.id,
    category_id: m.category_id,
    amount_bob: "20",
    usdt_quantity: "2",
    note: "Devolución anulada",
    voided: true,
    occurred_at: atDay("2026-01-03"),
  });
  const backup = createBackup(source, owner);
  await login(outsider);
  const plan = await prepareRestore(emptyState(), backup, outsider);
  await exec({
    id: uid(),
    type: "restore",
    payload: { state: plan.delta, expected_revision: 0 },
  });
  const restored = await read();
  expect(restored.accounts[0].archived).toBe(true);
  expect(
    restored.categories.find((c) => c.id === plan.merged.categories[0].id)
      ?.archived,
  ).toBe(true);
  expect(restored.movements.filter((m) => m.voided)).toHaveLength(2);
  expect(inventory(restored.movements).quantity).toBe("100");
  expect(inventory(restored.movements, "USDC").quantity).toBe("0");
  await expect(
    exec({
      id: uid(),
      type: "restore",
      payload: { state: plan.delta, expected_revision: 0 },
    }),
  ).rejects.toThrow("conflicto");
});
it("mantiene aisladas las herramientas y bloquea la función antigua", async () => {
  await exec({
    id: uid(),
    type: "planning",
    payload: planningState(state) as unknown as Record<string, unknown>,
  });
  await login(other);
  expect((await read()).planning?.version).toBe(0);
  await expect(
    db.query("select finance.apply_legacy_command($1::jsonb)", [
      JSON.stringify({
        id: uid(),
        type: "entity",
        entity: "profile",
        payload: state.profile,
      }),
    ]),
  ).rejects.toThrow("permission denied");
});
it("grupos usan invitación de un solo uso, aíslan terceros y exigen confirmar la recepción", async () => {
  const group = uid();
  await shared({
    id: group,
    action: "create",
    payload: { name: "Pareja", display_name: "Leo" },
  });
  const invite = await shared({
    id: uid(),
    group_id: group,
    action: "invite",
    payload: {},
  });
  await login(other);
  await shared({
    id: uid(),
    action: "join",
    payload: { code: invite.code, display_name: "Pareja" },
  });
  await login(outsider);
  await expect(
    shared({
      id: uid(),
      action: "join",
      payload: { code: invite.code, display_name: "Intruso" },
    }),
  ).rejects.toThrow("utilizado");
  const hidden = await db.query<{ result: { groups: unknown[] } }>(
    "select public.read_shared_finance() result",
  );
  expect(hidden.rows[0].result.groups).toHaveLength(0);
  await login(owner);
  await shared({
    id: uid(),
    group_id: group,
    action: "expense",
    payload: {
      amount: "100",
      note: "Cena",
      date: "2026-01-02",
      shares: equalShares("100", [owner, other]),
    },
  });
  await login(other);
  const payment = uid();
  await shared({
    id: payment,
    group_id: group,
    action: "settlement",
    payload: { to_id: owner, amount: "50", date: "2026-01-03" },
  });
  await expect(
    shared({
      id: payment,
      group_id: group,
      action: "confirm",
      payload: {},
      expected_version: 1,
    }),
  ).rejects.toThrow("quien recibe");
  await login(owner);
  await shared({
    id: payment,
    group_id: group,
    action: "confirm",
    payload: {},
    expected_version: 1,
  });
  const personal = await read();
  expect(report(personal, "2026-01-01", "2026-01-31").expense).toBe("0");
  const result = await db.query<{
    result: { groups: { settlements: { status: string }[] }[] };
  }>("select public.read_shared_finance() result");
  expect(result.rows[0].result.groups[0].settlements[0].status).toBe(
    "confirmed",
  );
});
