"use client";
import { useState } from "react";
import { useFinance } from "./finance-provider";
import { Button, ErrorMessage, Field } from "./ui";
import {
  createBackup,
  MAX_BACKUP_BYTES,
  prepareRestore,
  readBackup,
} from "@/lib/backup";
import {
  defaultMapping,
  movementFingerprint,
  parseCsv,
  previewCsv,
  type CsvMapping,
} from "@/lib/csv-import";
import { money, units } from "@/lib/finance";
import type { FinanceState } from "@/lib/types";

export function downloadFile(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function responseData(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? "No se pudo completar la operación.");
  return data;
}
type Preview = {
  added: number;
  duplicates: number;
  counts: Record<string, number>;
  remapped: boolean;
  pending: number;
  summary: { cash: string; usdt: string; usdc: string };
  revision?: number;
  merged?: FinanceState;
  signature: string;
};
async function csvId(value: string) {
  const b = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  b[6] = (b[6] & 15) | 80;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export function DataTools() {
  const ctx = useFinance(),
    { state, mode, pending, userId, notify } = ctx;
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [backup, setBackup] = useState<unknown>(null),
    [preview, setPreview] = useState<Preview | null>(null),
    [csv, setCsv] = useState<ReturnType<typeof parseCsv> | null>(null),
    [mapping, setMapping] = useState<CsvMapping | null>(null),
    [csvPreview, setCsvPreview] = useState<ReturnType<
      typeof previewCsv
    > | null>(null),
    [csvSignature, setCsvSignature] = useState(""),
    [account, setAccount] = useState(
      state.accounts.find((a) => !a.archived)?.id ?? "",
    ),
    [category, setCategory] = useState(
      state.categories.find((c) => c.type === "expense" && !c.archived)?.id ??
        "",
    ),
    [kind, setKind] = useState<"expense" | "income">("expense"),
    [duplicates, setDuplicates] = useState(false),
    [ack, setAck] = useState(false);
  async function run(action: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revisa el archivo.");
    } finally {
      setBusy(false);
    }
  }
  const canRestore = mode !== "demo" && pending.length === 0;
  return (
    <div className="form-stack data-tools">
      <section className="tool-section">
        <h3>Respaldo completo</h3>
        <p className="quiet">
          Incluye cuentas, categorías, movimientos anulados, lotes
          reconstruibles, metas, presupuestos, recurrentes, deudas y
          herramientas de tarjeta. El archivo contiene datos personales:
          guárdalo en un lugar privado. Los grupos compartidos permanecen en su
          espacio colaborativo.
        </p>
        <Button
          icon="Download"
          disabled={busy || !state.profile.onboarded}
          onClick={() =>
            void run(async () => {
              if (
                mode === "cloud" &&
                pending.length === 0 &&
                navigator.onLine
              ) {
                const r = await fetch("/api/backup", { cache: "no-store" });
                downloadFile(
                  `saldo-respaldo-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(await responseData(r), null, 2),
                );
              } else
                downloadFile(
                  `saldo-respaldo-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(
                    createBackup(state, userId, pending.length, pending),
                    null,
                    2,
                  ),
                );
              notify("Respaldo descargado.");
            })
          }
        >
          Descargar respaldo JSON
        </Button>
        {!!pending.length && (
          <p className="quiet">
            Hay {pending.length} registros sin confirmar. El respaldo local los
            identifica; sincroniza antes de restaurar.
          </p>
        )}
      </section>
      <section className="tool-section">
        <h3>Restaurar sin sobrescribir</h3>
        <p className="quiet">
          Combina registros nuevos, omite copias idénticas y detiene los
          conflictos. Límite: 3 MB. La vista previa muestra los saldos que
          quedarían.
        </p>
        {mode === "demo" && (
          <Button onClick={() => void ctx.switchMode("local")}>
            Ir a mi espacio local para restaurar
          </Button>
        )}
        <Field label="Archivo de respaldo JSON">
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy || !canRestore}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(null);
              setBackup(null);
              setAck(false);
              if (file)
                void run(async () => {
                  if (file.size > MAX_BACKUP_BYTES)
                    throw new Error("El archivo supera los 3 MB.");
                  const parsed = JSON.parse(await file.text());
                  readBackup(parsed);
                  setBackup(parsed);
                });
            }}
          />
        </Field>
        <Button
          disabled={busy || !backup || !canRestore}
          onClick={() =>
            void run(async () => {
              setAck(false);
              if (mode === "cloud") {
                if (!navigator.onLine)
                  throw new Error(
                    "Conéctate para revisar la restauración de la nube.",
                  );
                const p = await responseData(
                  await fetch("/api/backup", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ backup, preview: true }),
                  }),
                );
                setPreview({ ...p, signature: JSON.stringify(state) });
              } else {
                const p = await prepareRestore(state, backup, userId);
                setPreview({ ...p, signature: JSON.stringify(state) });
              }
            })
          }
        >
          Revisar respaldo
        </Button>
        {preview && (
          <div className="preview-box">
            <h4>Vista previa de restauración</h4>
            <p>
              {preview.added} registros nuevos · {preview.duplicates} copias
              idénticas omitidas.
            </p>
            <dl>
              <div>
                <dt>Bancos y efectivo</dt>
                <dd>{money(preview.summary.cash)}</dd>
              </div>
              <div>
                <dt>Saldo USDT</dt>
                <dd>{units(preview.summary.usdt)}</dd>
              </div>
              <div>
                <dt>Saldo USDC</dt>
                <dd>{units(preview.summary.usdc)}</dd>
              </div>
            </dl>
            {preview.remapped && (
              <p>Se crearán identificadores propios para este espacio.</p>
            )}
            {preview.pending > 0 && (
              <p className="warning">
                El archivo incluye {preview.pending} registros que no estaban
                confirmados. Revísalos antes de continuar.
              </p>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span>Revisé los saldos y quiero combinar estos registros.</span>
            </label>
            <Button
              className="primary"
              disabled={busy || !ack || !preview.added}
              onClick={() =>
                void run(async () => {
                  if (JSON.stringify(state) !== preview.signature)
                    throw new Error(
                      "Tus datos cambiaron. Genera otra vista previa.",
                    );
                  if (mode === "cloud") {
                    await responseData(
                      await fetch("/api/backup", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          backup,
                          expected_revision: preview.revision,
                        }),
                      }),
                    );
                    await ctx.sync();
                  } else
                    await ctx.restoreLocal(preview.merged!, preview.signature);
                  setPreview(null);
                  setBackup(null);
                  notify(
                    "Respaldo combinado. Tus registros anteriores se conservaron.",
                  );
                })
              }
            >
              Confirmar restauración
            </Button>
          </div>
        )}
      </section>
      <section className="tool-section">
        <h3>Importar movimientos CSV</h3>
        <p className="quiet">
          Hasta 500 filas. Admite el CSV exportado por Saldo y archivos con
          fecha, importe y descripción. Asigna las columnas y revisa errores y
          duplicados. Usa JSON para restaurar un espacio completo.
        </p>
        <Button
          onClick={() =>
            downloadFile(
              "saldo-plantilla.csv",
              "\uFEFFFecha;Tipo;BOB;USDT;Cuenta;Categoría;Descripción\r\n2026-10-17;expense;25;0;;;Ejemplo de compra",
              "text/csv;charset=utf-8",
            )
          }
        >
          Descargar plantilla CSV
        </Button>
        <Field label="Archivo CSV">
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy || !state.profile.onboarded}
            onChange={(e) => {
              const file = e.target.files?.[0];
              setCsvPreview(null);
              setCsv(null);
              if (file)
                void run(async () => {
                  const parsed = parseCsv(await file.text());
                  setCsv(parsed);
                  setMapping(defaultMapping(parsed.headers));
                });
            }}
          />
        </Field>
        {csv && mapping && (
          <>
            <div className="form-grid">
              {(
                [
                  ["date", "Columna fecha"],
                  ["amount", "Columna importe BOB"],
                  ["note", "Columna descripción"],
                  ["kind", "Columna tipo (opcional)"],
                  ["account", "Columna cuenta (opcional)"],
                  ["category", "Columna categoría (opcional)"],
                  ["quantity", "Columna USDT (opcional)"],
                ] as [keyof CsvMapping, string][]
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <select
                    value={mapping[key]}
                    onChange={(e) => {
                      setMapping({ ...mapping, [key]: e.target.value });
                      setCsvPreview(null);
                    }}
                  >
                    <option value="">Sin columna</option>
                    {csv.headers.map((h) => (
                      <option key={h}>{h}</option>
                    ))}
                  </select>
                </Field>
              ))}
              <Field label="Tipo predeterminado">
                <select
                  value={kind}
                  onChange={(e) => {
                    setKind(e.target.value as typeof kind);
                    setCategory("");
                    setCsvPreview(null);
                  }}
                >
                  <option value="expense">Gasto</option>
                  <option value="income">Ingreso</option>
                </select>
              </Field>
              <Field label="Cuenta predeterminada">
                <select
                  value={account}
                  onChange={(e) => {
                    setAccount(e.target.value);
                    setCsvPreview(null);
                  }}
                >
                  <option value="">Elegir</option>
                  {state.accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Categoría predeterminada">
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setCsvPreview(null);
                  }}
                >
                  <option value="">Elegir</option>
                  {state.categories
                    .filter((c) => !c.archived && c.type === kind)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={duplicates}
                onChange={(e) => {
                  setDuplicates(e.target.checked);
                  setCsvPreview(null);
                }}
              />
              <span>
                Incluir filas que parecen duplicadas. Confirmo que son
                operaciones distintas.
              </span>
            </label>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = previewCsv(
                    state,
                    csv,
                    mapping,
                    { account, category, kind },
                    duplicates,
                  );
                  setCsvPreview(result);
                  setCsvSignature(JSON.stringify(state));
                })
              }
            >
              Revisar CSV
            </Button>
            {csvPreview && (
              <div className="preview-box">
                <p>
                  {csvPreview.movements.length} movimientos nuevos ·{" "}
                  {csvPreview.duplicates} posibles duplicados
                  {duplicates ? " incluidos" : " omitidos"}.
                </p>
                {csvPreview.errors.map((e, i) => (
                  <p className="danger" key={i}>
                    {e}
                  </p>
                ))}
                <div className="preview-list">
                  {csvPreview.movements.slice(0, 20).map((m) => (
                    <div key={m.id}>
                      <span>
                        {m.occurred_at.slice(0, 10)} · {m.note || m.kind}
                      </span>
                      <strong>{money(m.amount_bob)}</strong>
                    </div>
                  ))}
                </div>
                <Button
                  className="primary"
                  disabled={
                    busy ||
                    !!csvPreview.errors.length ||
                    !csvPreview.movements.length
                  }
                  onClick={() =>
                    void run(async () => {
                      if (JSON.stringify(state) !== csvSignature)
                        throw new Error(
                          "Tus datos cambiaron. Revisa otra vez el CSV.",
                        );
                      const commands = [];
                      for (const m of csvPreview.movements) {
                        const id = duplicates
                          ? m.id
                          : await csvId(
                              `saldo-csv-v2:${userId}:${movementFingerprint(m)}`,
                            );
                        commands.push({
                          id,
                          type: "movement",
                          payload: { ...m, id },
                        });
                      }
                      await ctx.dispatch({
                        id: crypto.randomUUID(),
                        type: "batch",
                        payload: { commands },
                      });
                      setCsvPreview(null);
                      setCsv(null);
                      notify(
                        "CSV importado como un único lote. Revisa su sincronización.",
                      );
                    })
                  }
                >
                  Confirmar importación
                </Button>
              </div>
            )}
          </>
        )}
      </section>
      <ErrorMessage error={error} />
    </div>
  );
}
