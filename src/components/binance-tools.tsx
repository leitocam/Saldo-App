"use client";
import { useState, type FormEvent } from "react";
import { useFinance } from "./finance-provider";
import { Button, ErrorMessage, Field, Modal, SectionHead } from "./ui";
import {
  D,
  atDay,
  decimal,
  inventory,
  localDay,
  money,
  today,
  units,
} from "@/lib/finance";
import { planningCommand, planningState } from "@/lib/planning";
import { newMovement, uid } from "@/lib/demo";
import type { CardDraft, Command, Movement } from "@/lib/types";

export function BinanceTools({ onEdit }: { onEdit: (m: Movement) => void }) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state),
    usdc = inventory(state.movements, "USDC");
  const [view, setView] = useState("balances"),
    [modal, setModal] = useState<
      "reconcile" | "draft" | "refund" | "cashback" | "reference" | null
    >(null),
    [draft, setDraft] = useState<CardDraft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function status(d: CardDraft, status: CardDraft["status"]) {
    setBusy(true);
    setError("");
    try {
      const commands: Command[] = [];
      const next = {
        ...p,
        card_drafts: p.card_drafts.map((x) =>
          x.id === d.id ? { ...x, status } : x,
        ),
      };
      if (status === "completed") {
        const m = {
          ...newMovement("card"),
          id: d.id,
          amount_bob: d.amount_bob,
          usdt_quantity: d.usdt_quantity,
          category_id: d.category_id,
          note: d.note,
          occurred_at: atDay(d.date),
          card_amount: d.card_amount,
          card_currency: d.card_currency,
        };
        commands.push({ id: m.id, type: "movement", payload: m });
        commands.push(planningCommand(state, next));
      } else {
        commands.push(planningCommand(state, next));
        if (d.status === "completed") {
          const m = state.movements.find((x) => x.id === d.id);
          if (!m) throw new Error("No encontramos el consumo.");
          commands.push({
            id: m.id,
            type: "void",
            payload: {},
            expected_version: m.version,
          });
        }
      }
      await dispatch({ id: uid(), type: "batch", payload: { commands } });
      notify(
        status === "completed"
          ? "Cargo confirmado. USDT y gasto actualizados."
          : "Cargo cancelado.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel tools-panel">
      <SectionHead title="Control de Binance">
        <Button onClick={() => setModal("reconcile")}>Conciliar saldo</Button>
      </SectionHead>
      <div className="segmented tools-tabs">
        {[
          ["balances", "Saldos"],
          ["pending", "Cargos pendientes"],
          ["receipts", "Devoluciones y cashback"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {view === "balances" && (
        <>
          <div className="forecast-grid">
            <div>
              <span>USDT registrados</span>
              <strong>{units(inventory(state.movements).quantity)}</strong>
              <small>Las reservas de metas se mantienen en USDT</small>
            </div>
            <div>
              <span>USDC registrados</span>
              <strong>{units(usdc.quantity)}</strong>
              <small>
                {p.usdc_reference
                  ? `${money(D(usdc.quantity).mul(p.usdc_reference.price))} · Referencia manual`
                  : "Valor BOB pendiente de referencia"}
              </small>
            </div>
          </div>
          <p className="quiet">
            USDC y USDT tienen inventarios separados. Una devolución en USDC no
            aumenta tus USDT. La conciliación compara el saldo real e identifica
            ajustes explícitos con su motivo.
          </p>
          <Button onClick={() => setModal("reference")}>
            Referencia manual USDC/BOB
          </Button>
          {p.usdc_reference && (
            <p className="quiet">
              Referencia {money(p.usdc_reference.price)} por USDC ·{" "}
              {new Date(p.usdc_reference.observed_at).toLocaleString("es-BO", {
                timeZone: "America/La_Paz",
              })}
              {Date.now() - Date.parse(p.usdc_reference.observed_at) > 900000
                ? " · Desactualizada"
                : ""}
            </p>
          )}
          <details>
            <summary>
              Historial de conciliaciones ({p.reconciliations.length})
            </summary>
            <div className="preview-list">
              {[...p.reconciliations]
                .reverse()
                .slice(0, 30)
                .map((r) => (
                  <div key={r.id}>
                    <span>
                      {r.date} · {r.asset} · {r.note}
                      <small>
                        Registrado {r.recorded} · observado {r.observed}
                      </small>
                    </span>
                    <strong>
                      {r.movement_id ? "Ajustado" : "Solo comprobado"}
                    </strong>
                  </div>
                ))}
            </div>
          </details>
        </>
      )}
      {view === "pending" && (
        <>
          <p className="quiet">
            Un cargo pendiente es informativo. Se descontará del inventario y
            contará como gasto al confirmar el cargo completado por Binance.
            Antes de confirmar, edita sus importes si cambiaron.
          </p>
          <Button
            icon="Plus"
            onClick={() => {
              setDraft(null);
              setModal("draft");
            }}
          >
            Nuevo cargo pendiente
          </Button>
          <div className="tool-list">
            {[...p.card_drafts].reverse().map((d) => (
              <div key={d.id} className="tool-row">
                <div className="tool-row-main">
                  <strong>{d.note}</strong>
                  <small>
                    {d.date} ·{" "}
                    {d.status === "pending"
                      ? "Pendiente"
                      : d.status === "completed"
                        ? "Completado"
                        : "Cancelado"}{" "}
                    · {units(d.usdt_quantity)} USDT
                  </small>
                </div>
                <strong>{money(d.amount_bob)}</strong>
                {d.status === "pending" && (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setDraft(d);
                        setModal("draft");
                      }}
                    >
                      Editar cargo
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => void status(d, "completed")}
                    >
                      Confirmar cargo
                    </Button>
                  </>
                )}
                {d.status !== "cancelled" && (
                  <Button
                    disabled={busy}
                    onClick={() => void status(d, "cancelled")}
                  >
                    {d.status === "completed"
                      ? "Anular registro"
                      : "Cancelar cargo"}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {view === "receipts" && (
        <>
          <p className="quiet">
            Registra la moneda y cantidad realmente recibidas. Una devolución
            reduce el gasto del consumo original; las comisiones no se suponen
            devueltas. El cashback se conserva como activo recibido y se muestra
            por separado.
          </p>
          <div className="inline-actions">
            <Button onClick={() => setModal("refund")}>
              Registrar devolución
            </Button>
            <Button onClick={() => setModal("cashback")}>
              Registrar cashback
            </Button>
          </div>
          <div className="tool-list">
            {state.movements
              .filter(
                (m) =>
                  !m.voided &&
                  ["refund", "cashback", "crypto_in", "crypto_out"].includes(
                    m.kind,
                  ),
              )
              .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
              .map((m) => (
                <button
                  key={m.id}
                  className="tool-row"
                  onClick={() => onEdit(m)}
                >
                  <span className="tool-row-main">
                    <strong>{m.note}</strong>
                    <small>
                      {localDay(m.occurred_at)} ·{" "}
                      {m.kind === "refund"
                        ? "Devolución"
                        : m.kind === "cashback"
                          ? "Cashback"
                          : "Ajuste"}
                    </small>
                  </span>
                  <strong>
                    {units(m.usdt_quantity)} {m.asset ?? "USDT"}
                  </strong>
                  <span>
                    {m.amount_bob === null
                      ? "Costo sin determinar"
                      : money(m.amount_bob)}
                  </span>
                </button>
              ))}
          </div>
        </>
      )}
      <ErrorMessage error={error} />
      {modal === "reconcile" && (
        <CryptoReconcile onClose={() => setModal(null)} />
      )}
      {modal === "draft" && (
        <CardDraftForm initial={draft} onClose={() => setModal(null)} />
      )}
      {(modal === "refund" || modal === "cashback") && (
        <CryptoEntryForm kind={modal} onClose={() => setModal(null)} />
      )}
      {modal === "reference" && (
        <UsdcReference onClose={() => setModal(null)} />
      )}
    </section>
  );
}
function CryptoReconcile({ onClose }: { onClose: () => void }) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [asset, setAsset] = useState<"USDT" | "USDC">("USDT"),
    [actual, setActual] = useState(""),
    [note, setNote] = useState(""),
    [cost, setCost] = useState(""),
    [adjust, setAdjust] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const recorded = inventory(state.movements, asset).quantity,
    valid = /^\d+([.,]\d+)?$/.test(actual),
    delta = valid ? D(actual.replace(",", ".")).minus(recorded) : null;
  return (
    <Modal title="Conciliar saldo de Binance" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const observed = decimal(actual),
              diff = D(observed).minus(recorded);
            if (D(observed).lt(0) || D(observed).decimalPlaces() > 8)
              throw new Error(
                "Indica un saldo no negativo con hasta ocho decimales.",
              );
            const commands: Command[] = [];
            let movement_id: string | null = null;
            if (adjust && !diff.isZero()) {
              const m = {
                ...newMovement(diff.gt(0) ? "crypto_in" : "crypto_out"),
                asset,
                usdt_quantity: diff.abs().toFixed(),
                amount_bob: diff.gt(0) && cost ? decimal(cost) : null,
                note: `Conciliación · ${note}`,
              };
              movement_id = m.id;
              commands.push({ id: m.id, type: "movement", payload: m });
            }
            const record = {
              id: uid(),
              asset,
              recorded,
              observed,
              date: today(),
              note: note.trim(),
              movement_id,
            };
            commands.push(
              planningCommand(state, {
                ...p,
                reconciliations: [...p.reconciliations, record],
              }),
            );
            await dispatch({
              id: uid(),
              type: "batch",
              payload: { commands, expected_inventory: { [asset]: recorded } },
            });
            notify(
              adjust && !diff.isZero()
                ? "Saldo ajustado con trazabilidad."
                : "Comprobación guardada.",
            );
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Activo a conciliar">
          <select
            value={asset}
            onChange={(e) => setAsset(e.target.value as typeof asset)}
          >
            <option>USDT</option>
            <option>USDC</option>
          </select>
        </Field>
        <p className="form-callout">
          Saldo registrado: {units(recorded)} {asset}
        </p>
        <Field label="Saldo real observado">
          <input
            inputMode="decimal"
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            required
          />
        </Field>
        {delta && (
          <p>
            Diferencia: {delta.gt(0) ? "+" : ""}
            {units(delta)} {asset}
          </p>
        )}
        <Field label="Motivo de la conciliación">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            maxLength={120}
          />
        </Field>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={adjust}
            onChange={(e) => setAdjust(e.target.checked)}
          />
          <span>
            Crear un ajuste por la diferencia.
            <small>
              Una entrada sin costo conocido se marcará como costo incompleto.
            </small>
          </span>
        </label>
        {adjust && delta?.gt(0) && (
          <Field label="Costo total BOB de los fondos añadidos (opcional)">
            <input
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="Sin costo conocido"
            />
          </Field>
        )}
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <Button type="submit" className="primary full" disabled={busy}>
            Guardar conciliación
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function CardDraftForm({
  initial,
  onClose,
}: {
  initial: CardDraft | null;
  onClose: () => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [base] = useState(p.version),
    [amount, setAmount] = useState(initial?.amount_bob ?? ""),
    [quantity, setQuantity] = useState(initial?.usdt_quantity ?? ""),
    [note, setNote] = useState(initial?.note ?? ""),
    [date, setDate] = useState(initial?.date ?? today()),
    [category, setCategory] = useState(
      initial?.category_id ??
        state.categories.find((c) => !c.archived && c.type === "expense")?.id ??
        "",
    ),
    [currency, setCurrency] = useState(initial?.card_currency ?? "BOB"),
    [merchant, setMerchant] = useState(initial?.card_amount ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={initial ? "Editar cargo pendiente" : "Nuevo cargo pendiente"}
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (base !== p.version)
              throw new Error(
                "Los cargos cambiaron. Cierra y vuelve a abrir este formulario.",
              );
            const bob = decimal(amount);
            const d: CardDraft = {
              id: initial?.id ?? uid(),
              amount_bob: bob,
              usdt_quantity: decimal(quantity),
              note: note.trim(),
              date,
              category_id: category,
              card_currency: currency,
              card_amount: currency === "BOB" ? bob : decimal(merchant),
              status: "pending",
            };
            await dispatch(
              planningCommand(state, {
                ...p,
                card_drafts: initial
                  ? p.card_drafts.map((x) => (x.id === initial.id ? d : x))
                  : [...p.card_drafts, d],
              }),
            );
            notify("Cargo pendiente guardado; todavía no afecta saldos.");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Comercio del cargo pendiente">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={120}
            required
          />
        </Field>
        <Field label="Equivalente BOB del cargo">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="USDT del cargo pendiente">
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
        <Field label="Moneda original del cargo">
          <input
            value={currency}
            maxLength={3}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            required
          />
        </Field>
        {currency !== "BOB" && (
          <Field label="Importe original del cargo">
            <input
              inputMode="decimal"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              required
            />
          </Field>
        )}
        <Field label="Categoría del cargo">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
          >
            {state.categories
              .filter((c) => !c.archived && c.type === "expense")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Fecha del cargo">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </Field>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <Button type="submit" className="primary full" disabled={busy}>
            Guardar cargo pendiente
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function CryptoEntryForm({
  kind,
  initial,
  onClose,
}: {
  kind: Movement["kind"];
  initial?: Movement;
  onClose: () => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [asset, setAsset] = useState<"USDT" | "USDC">(initial?.asset ?? "USDT"),
    [quantity, setQuantity] = useState(initial?.usdt_quantity ?? ""),
    [amount, setAmount] = useState(initial?.amount_bob ?? ""),
    [date, setDate] = useState(
      initial ? localDay(initial.occurred_at) : today(),
    ),
    [note, setNote] = useState(initial?.note ?? ""),
    [parent, setParent] = useState(initial?.parent_id ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const linked =
    !!initial && p.reconciliations.some((r) => r.movement_id === initial.id);
  const cards = state.movements.filter((m) => m.kind === "card" && !m.voided),
    original = cards.find((m) => m.id === parent);
  const refundRemaining = original
    ? D(original.amount_bob).minus(
        state.movements
          .filter(
            (m) =>
              m.kind === "refund" &&
              !m.voided &&
              m.parent_id === parent &&
              m.id !== initial?.id,
          )
          .reduce((sum, m) => sum.plus(m.amount_bob ?? 0), D(0)),
      )
    : null;
  return (
    <Modal
      title={
        kind === "refund"
          ? "Devolución de tarjeta"
          : kind === "cashback"
            ? "Cashback recibido"
            : "Detalle de ajuste cripto"
      }
      onClose={onClose}
    >
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (linked)
              throw new Error(
                "Este ajuste pertenece a una conciliación. Registra una nueva comprobación para corregirlo.",
              );
            const m: Movement = {
              ...(initial ?? newMovement(kind)),
              asset,
              usdt_quantity: decimal(quantity),
              amount_bob:
                kind === "crypto_out" ? null : amount ? decimal(amount) : null,
              occurred_at: atDay(date),
              note: note.trim(),
              parent_id: kind === "refund" ? parent : null,
              category_id:
                kind === "refund" ? (original?.category_id ?? null) : null,
            };
            await dispatch({
              id: m.id,
              type: "movement",
              payload: m,
              ...(initial ? { expected_version: initial.version } : {}),
            });
            notify("Movimiento recibido guardado.");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {linked && (
          <p className="form-callout">
            Ajuste vinculado a una conciliación. Para corregir diferencias,
            registra una nueva conciliación con el saldo real.
          </p>
        )}
        {kind === "refund" && (
          <Field label="Consumo original de la devolución">
            <select
              value={parent}
              onChange={(e) => setParent(e.target.value)}
              required
              disabled={linked}
            >
              <option value="">Elegir consumo</option>
              {cards.map((m) => (
                <option key={m.id} value={m.id}>
                  {localDay(m.occurred_at)} · {m.note || "Tarjeta"} ·{" "}
                  {money(m.amount_bob)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {refundRemaining && (
          <p className="quiet">
            Máximo por devolver: {money(refundRemaining)}. Registra el importe
            realmente reembolsado, sin asumir devolución de comisiones.
          </p>
        )}
        <Field label="Activo recibido">
          <select
            value={asset}
            disabled={linked}
            onChange={(e) => setAsset(e.target.value as typeof asset)}
          >
            <option>USDT</option>
            <option>USDC</option>
          </select>
        </Field>
        <Field label="Cantidad de criptomoneda">
          <input
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            readOnly={linked}
          />
        </Field>
        {kind !== "crypto_out" && (
          <Field
            label={
              kind === "refund"
                ? "Importe reembolsado equivalente BOB"
                : "Valor o costo total BOB al recibir (opcional)"
            }
          >
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required={kind === "refund"}
              readOnly={linked}
              placeholder="Costo desconocido"
            />
          </Field>
        )}
        <Field label="Concepto del movimiento cripto">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            maxLength={1000}
            readOnly={linked}
          />
        </Field>
        <Field label="Fecha del movimiento cripto">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            readOnly={linked}
          />
        </Field>
        <ErrorMessage error={error} />
        {!linked && (
          <div className="dialog-actions">
            <Button type="submit" className="primary full" disabled={busy}>
              Guardar movimiento cripto
            </Button>
            {initial && (
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await dispatch({
                      id: initial.id,
                      type: "void",
                      payload: {},
                      expected_version: initial.version,
                    });
                    notify("Movimiento anulado.");
                    onClose();
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Anular movimiento cripto
              </Button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
function UsdcReference({ onClose }: { onClose: () => void }) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [price, setPrice] = useState(p.usdc_reference?.price ?? ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Modal title="Referencia manual USDC/BOB" onClose={onClose}>
      <form
        className="form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await dispatch(
              planningCommand(state, {
                ...p,
                usdc_reference: {
                  price: decimal(price),
                  observed_at: new Date().toISOString(),
                },
              }),
            );
            notify("Referencia USDC guardada como manual.");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="quiet">
          Introduce una referencia para valorar tus USDC. No se reutiliza
          automáticamente la cotización P2P de USDT.
        </p>
        <Field label="BOB por USDC">
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </Field>
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <Button className="primary full" type="submit" disabled={busy}>
            Guardar referencia USDC
          </Button>
        </div>
      </form>
    </Modal>
  );
}
