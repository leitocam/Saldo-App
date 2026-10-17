import { D, atDay, decimal, localDay } from "./finance";
import { newMovement } from "./demo";
import { applyCommand } from "./commands";
import type { FinanceState, Movement } from "./types";

export function parseCsv(text: string) {
  if (new TextEncoder().encode(text).length > 3_000_000)
    throw new Error("El CSV supera los 3 MB.");
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const delimiter =
    (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0)
      ? ";"
      : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const input = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (!cell || quoted) quoted = !quoted;
      else throw new Error("Comillas CSV inválidas.");
    } else if (!quoted && (c === delimiter || c === "\n" || c === "\r")) {
      row.push(cell);
      cell = "";
      if (c !== delimiter) {
        if (c === "\r" && input[i + 1] === "\n") i++;
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      }
    } else cell += c;
  }
  if (quoted) throw new Error("El CSV contiene una celda sin cerrar.");
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  if (rows.length < 2 || rows.length > 501)
    throw new Error("Importa entre 1 y 500 filas por archivo.");
  const headers = rows.shift()!.map((x) => x.trim());
  if (new Set(headers).size !== headers.length)
    throw new Error("Hay columnas repetidas.");
  if (rows.some((r) => r.length !== headers.length))
    throw new Error("Las filas no tienen el mismo número de columnas.");
  return { headers, rows };
}
export type CsvMapping = {
  date: string;
  amount: string;
  note: string;
  kind: string;
  account: string;
  category: string;
  quantity: string;
  destination: string;
  card_amount: string;
  card_currency: string;
  fee_bob: string;
  fee_usdt: string;
};
export function defaultMapping(headers: string[]): CsvMapping {
  const find = (...names: string[]) =>
    headers.find((h) => names.some((n) => h.toLowerCase() === n)) ?? "";
  return {
    date: find("fecha", "date"),
    amount: find("bob", "importe", "monto", "amount"),
    note: find(
      "descripción",
      "descripcion",
      "concepto",
      "detalle",
      "description",
    ),
    kind: find("tipo", "type"),
    account: find("cuenta", "account"),
    category: find("categoría", "categoria"),
    quantity: find("usdt"),
    destination: find("destino"),
    card_amount: find("importe comercio"),
    card_currency: find("moneda comercio"),
    fee_bob: find("comisión bob"),
    fee_usdt: find("comisión usdt"),
  };
}
const normalized = (v: string) => v.trim().toLocaleLowerCase("es");
function number(v: string) {
  let s = v
    .trim()
    .replace(/\s/g, "")
    .replace(/^(Bs\.?|BOB|USD|\$)/i, "");
  if (s.includes(",") && s.includes(".")) {
    const comma = s.lastIndexOf(",") > s.lastIndexOf(".");
    s = comma ? s.replaceAll(".", "").replace(",", ".") : s.replaceAll(",", "");
  }
  return decimal(s);
}
export function movementFingerprint(m: Movement) {
  return [
    m.kind,
    m.account_id,
    m.destination_id,
    m.category_id,
    localDay(m.occurred_at),
    m.amount_bob === null ? "" : D(m.amount_bob).toFixed(),
    D(m.usdt_quantity).toFixed(),
    D(m.fee_bob).toFixed(),
    D(m.fee_usdt).toFixed(),
    m.note.trim(),
    m.asset ?? "USDT",
    m.card_amount === null ? "" : D(m.card_amount).toFixed(),
    m.card_currency ?? "",
  ].join("\u0001");
}
export function previewCsv(
  s: FinanceState,
  parsed: ReturnType<typeof parseCsv>,
  mapping: CsvMapping,
  defaults: { account: string; category: string; kind: "expense" | "income" },
  includeDuplicates = false,
) {
  if (!mapping.date || !mapping.amount)
    throw new Error("Selecciona las columnas de fecha e importe.");
  const seen = new Set(
    s.movements.filter((m) => !m.voided).map(movementFingerprint),
  );
  let duplicates = 0;
  const errors: string[] = [],
    movements: Movement[] = [];
  parsed.rows.forEach((row, index) => {
    try {
      const get = (key: keyof CsvMapping) =>
        mapping[key]
          ? (row[parsed.headers.indexOf(mapping[key])]?.trim() ?? "")
          : "";
      const aliases: Record<string, Movement["kind"]> = {
        gasto: "expense",
        ingreso: "income",
        transferencia: "transfer",
        compra: "buy",
        venta: "sell",
        tarjeta: "card",
        ajuste: "adjustment",
      };
      const rawKind = normalized(get("kind"));
      const kind = (aliases[rawKind] ??
        rawKind ??
        defaults.kind) as Movement["kind"];
      const type = rawKind ? kind : defaults.kind;
      if (
        ![
          "expense",
          "income",
          "transfer",
          "buy",
          "sell",
          "card",
          "adjustment",
        ].includes(type)
      )
        throw new Error(
          "Tipo no admitido; usa respaldo JSON para otros movimientos.",
        );
      let date = get("date");
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
        const [d, m, y] = date.split("/");
        date = `${y}-${m}-${d}`;
      }
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date
      )
        throw new Error("Fecha inválida (AAAA-MM-DD o DD/MM/AAAA).");
      const account = get("account")
        ? s.accounts.find(
            (a) => normalized(a.name) === normalized(get("account")),
          )?.id
        : defaults.account;
      const category = get("category")
        ? s.categories.find(
            (c) =>
              normalized(c.name) === normalized(get("category")) &&
              c.type === (type === "income" ? "income" : "expense"),
          )?.id
        : defaults.category;
      const m: Movement = {
        ...newMovement(type),
        amount_bob: (type === "adjustment"
          ? D(number(get("amount")))
          : D(number(get("amount"))).abs()
        ).toFixed(),
        account_id: type === "card" ? null : (account ?? null),
        category_id: ["expense", "income", "card"].includes(type)
          ? (category ?? null)
          : null,
        occurred_at: atDay(date),
        note: get("note").replace(/^'(?=[=+\-@\t\r])/, ""),
        usdt_quantity: ["buy", "sell", "card"].includes(type)
          ? number(get("quantity"))
          : "0",
        fee_bob: get("fee_bob") ? number(get("fee_bob")) : "0",
        fee_usdt: get("fee_usdt") ? number(get("fee_usdt")) : "0",
      };
      if (type === "transfer")
        m.destination_id =
          s.accounts.find(
            (a) => normalized(a.name) === normalized(get("destination")),
          )?.id ?? null;
      if (type === "card") {
        m.card_currency = get("card_currency") || "BOB";
        m.card_amount =
          m.card_currency === "BOB" ? m.amount_bob : number(get("card_amount"));
      }
      const fingerprint = movementFingerprint(m);
      if (seen.has(fingerprint)) {
        duplicates++;
        if (!includeDuplicates) return;
      }
      seen.add(fingerprint);
      movements.push(m);
    } catch (e) {
      errors.push(
        `Fila ${index + 2}: ${e instanceof Error ? e.message : "datos inválidos"}`,
      );
    }
  });
  const ordered = [...movements].sort(
    (a, b) =>
      Number(["buy"].includes(b.kind)) - Number(["buy"].includes(a.kind)) ||
      Date.parse(a.occurred_at) - Date.parse(b.occurred_at),
  );
  if (!errors.length && ordered.length) {
    try {
      applyCommand(s, {
        id: crypto.randomUUID(),
        type: "batch",
        payload: {
          commands: ordered.map((m) => ({
            id: m.id,
            type: "movement",
            payload: m,
          })),
        },
      });
    } catch (e) {
      errors.push(
        e instanceof Error ? e.message : "No se pudo validar el archivo.",
      );
    }
  }
  return { movements: ordered, errors, duplicates };
}
