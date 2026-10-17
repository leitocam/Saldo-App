"use client";
import { useState, type FormEvent } from "react";
import { useFinance } from "./finance-provider";
import { Button, ErrorMessage, Field, Icon, Modal, SectionHead } from "./ui";
import {
  D,
  atDay,
  decimal,
  displayDate,
  money,
  today,
  units,
} from "@/lib/finance";
import {
  debtRemaining,
  debtTotals,
  monthlyAvailable,
  planningCommand,
  planningState,
} from "@/lib/planning";
import { newMovement, uid } from "@/lib/demo";
import type { Command, Debt } from "@/lib/types";

export function AvailablePanel({ hidden = false }: { hidden?: boolean }) {
  const { state } = useFinance();
  let forecast;
  try {
    forecast = monthlyAvailable(state);
  } catch {
    return (
      <section className="panel forecast-panel">
        <h3>Disponible del mes</h3>
        <p>
          Revisa las fechas de tus pagos recurrentes para calcular la
          proyección.
        </p>
      </section>
    );
  }
  const debts = debtTotals(state);
  return (
    <section className="panel forecast-panel">
      <div className="section-head">
        <div>
          <p className="eyebrow">HASTA FIN DE MES</p>
          <h2>¿Cuánto puedes gastar?</h2>
        </div>
        <Icon name="CalendarDays" />
      </div>
      <div className="forecast-grid">
        <div>
          <span>Disponible después de pagos</span>
          <strong className={forecast.free.lt(0) ? "danger" : "positive"}>
            {hidden ? "••••" : money(forecast.free)}
          </strong>
          <small>De tus bancos y efectivo actuales</small>
        </div>
        <div>
          <span>Referencia por día</span>
          <strong>{hidden ? "••••" : money(forecast.daily)}</strong>
          <small>{forecast.days} días incluidos desde hoy</small>
        </div>
        <div>
          <span>Pagos por cubrir</span>
          <strong>{hidden ? "••••" : money(forecast.committed)}</strong>
          <small>
            Recurrentes vencidos y próximos · deudas con vencimiento
          </small>
        </div>
      </div>
      <p className="quiet">
        Los ingresos futuros y la valoración de criptomonedas no se suman al
        dinero listo para gastar. Tus metas USDT siguen reservadas en Binance.
      </p>
      <details>
        <summary>Ver próximos compromisos ({forecast.payments.length})</summary>
        <div className="preview-list">
          {forecast.payments.slice(0, 50).map((p) => (
            <div key={p.id}>
              <span>
                {p.date} · {p.name}
                {p.overdue ? " · Vencido" : ""}
              </span>
              <strong>{hidden ? "••••" : money(p.amount)}</strong>
            </div>
          ))}
          {!forecast.payments.length && (
            <p className="quiet">No hay pagos pendientes hasta fin de mes.</p>
          )}
        </div>
      </details>
      <p className="quiet">
        USDT libres: {hidden ? "••••" : units(forecast.availableUsdt)} · Por
        cobrar: {hidden ? "••••" : money(debts.receivable)} · Deudas pendientes:{" "}
        {hidden ? "••••" : money(debts.payable)}
      </p>
    </section>
  );
}
export function DebtTools() {
  const ctx = useFinance(),
    { state, dispatch, notify } = ctx,
    p = planningState(state),
    totals = debtTotals(state);
  const [selected, setSelected] = useState<Debt | null | undefined>(),
    [paying, setPaying] = useState<Debt | null>(null),
    [error, setError] = useState("");
  const active = p.debts.filter((d) => !d.archived);
  return (
    <section className="panel tools-panel">
      <SectionHead title="Deudas y préstamos">
        <Button icon="Plus" onClick={() => setSelected(null)}>
          Nueva deuda
        </Button>
      </SectionHead>
      <div className="forecast-grid">
        <div>
          <span>Te deben</span>
          <strong className="positive">{money(totals.receivable)}</strong>
        </div>
        <div>
          <span>Debes</span>
          <strong>{money(totals.payable)}</strong>
        </div>
      </div>
      <p className="quiet">
        El capital y sus pagos se registran como movimientos de fondos,
        separados del consumo. Las deudas pendientes forman parte del patrimonio
        como activo o pasivo.
      </p>
      <div className="tool-list">
        {active.map((d) => (
          <div className="tool-row" key={d.id}>
            <button className="tool-row-main" onClick={() => setSelected(d)}>
              <strong>{d.name}</strong>
              <small>
                {d.direction === "receivable" ? "Te debe" : "Debes"}
                {d.due_date ? ` · ${d.due_date}` : ""}
              </small>
            </button>
            <strong>{money(debtRemaining(d))}</strong>
            <Button
              disabled={debtRemaining(d).isZero()}
              onClick={() => setPaying(d)}
            >
              {d.direction === "receivable"
                ? "Registrar cobro"
                : "Registrar pago"}
            </Button>
          </div>
        ))}
      </div>
      {!active.length && (
        <p className="quiet">
          Registra un préstamo o una deuda pendiente para llevar sus pagos
          parciales.
        </p>
      )}
      {p.debts.some((d) => d.archived) && (
        <details>
          <summary>Historial de deudas saldadas</summary>
          {p.debts
            .filter((d) => d.archived)
            .map((d) => (
              <button
                className="setting-row"
                key={d.id}
                onClick={() => setSelected(d)}
              >
                {d.name} · Saldada
              </button>
            ))}
        </details>
      )}
      <ErrorMessage error={error} />
      {selected !== undefined && (
        <DebtEditor
          initial={selected}
          onClose={() => setSelected(undefined)}
          onError={setError}
        />
      )}
      {paying && (
        <DebtPaymentForm debt={paying} onClose={() => setPaying(null)} />
      )}
    </section>
  );
}
function DebtEditor({
  initial,
  onClose,
  onError,
}: {
  initial: Debt | null;
  onClose: () => void;
  onError: (s: string) => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [baseVersion] = useState(p.version);
  const [name, setName] = useState(initial?.name ?? ""),
    [direction, setDirection] = useState<Debt["direction"]>(
      initial?.direction ?? "receivable",
    ),
    [principal, setPrincipal] = useState(initial?.principal ?? ""),
    [due, setDue] = useState(initial?.due_date ?? ""),
    [note, setNote] = useState(initial?.note ?? ""),
    [included, setIncluded] = useState(true),
    [account, setAccount] = useState(
      state.accounts.find((a) => !a.archived)?.id ?? "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (baseVersion !== p.version)
        throw new Error(
          "Las deudas cambiaron. Cierra y vuelve a abrir este formulario.",
        );
      const amount = decimal(principal);
      if (D(amount).lte(0) || D(amount).decimalPlaces() > 2)
        throw new Error("Indica un capital positivo en BOB.");
      const d: Debt = initial
        ? { ...initial, name: name.trim(), note, due_date: due || null }
        : {
            id: uid(),
            name: name.trim(),
            direction,
            principal: amount,
            due_date: due || null,
            note,
            archived: false,
            opening_movement_id: null,
            payments: [],
          };
      const commands: Command[] = [];
      if (!initial && !included) {
        const m = {
          ...newMovement("adjustment"),
          account_id: account,
          amount_bob: D(amount)
            .mul(direction === "receivable" ? -1 : 1)
            .toFixed(),
          note: `Capital de deuda · ${name}`,
        };
        d.opening_movement_id = m.id;
        commands.push({ id: m.id, type: "movement", payload: m });
      }
      const next = {
        ...p,
        debts: initial
          ? p.debts.map((x) => (x.id === d.id ? d : x))
          : [...p.debts, d],
      };
      commands.push(planningCommand(state, next));
      await dispatch({ id: uid(), type: "batch", payload: { commands } });
      notify("Deuda guardada.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={initial ? "Detalle de deuda" : "Nueva deuda o préstamo"}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <Field label="Persona o concepto">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={120}
          />
        </Field>
        <Field label="Dirección">
          <select
            value={direction}
            disabled={!!initial}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="receivable">Me deben · presté dinero</option>
            <option value="payable">Debo · recibí dinero prestado</option>
          </select>
        </Field>
        <Field label="Capital en BOB">
          <input
            inputMode="decimal"
            value={principal}
            readOnly={!!initial}
            onChange={(e) => setPrincipal(e.target.value)}
            required
          />
        </Field>
        <Field label="Vencimiento (opcional)">
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
        </Field>
        <Field label="Nota de la deuda">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
        </Field>
        {!initial && (
          <>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={included}
                onChange={(e) => setIncluded(e.target.checked)}
              />
              <span>
                Este dinero ya está reflejado en mis saldos actuales.
                <small>No se repetirá el movimiento bancario.</small>
              </span>
            </label>
            {!included && (
              <Field label="Cuenta del desembolso">
                <select
                  value={account}
                  onChange={(e) => setAccount(e.target.value)}
                  required
                >
                  <option value="">Elegir</option>
                  {state.accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
          </>
        )}
        {initial && (
          <>
            <p className="form-callout">
              Pendiente: {money(debtRemaining(initial))}
            </p>
            <div className="preview-list">
              {initial.payments.map((pay) => (
                <div key={pay.id}>
                  <span>
                    {pay.date} · {money(pay.amount)}
                  </span>
                  <button
                    type="button"
                    className="text-button danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        if (baseVersion !== p.version)
                          throw new Error(
                            "Las deudas cambiaron. Vuelve a abrir este detalle.",
                          );
                        const m = state.movements.find(
                          (x) => x.id === pay.movement_id,
                        );
                        if (!m) throw new Error("No encontramos el pago.");
                        const updated = {
                          ...initial,
                          payments: initial.payments.filter(
                            (x) => x.id !== pay.id,
                          ),
                        };
                        await dispatch({
                          id: uid(),
                          type: "batch",
                          payload: {
                            commands: [
                              planningCommand(state, {
                                ...p,
                                debts: p.debts.map((x) =>
                                  x.id === initial.id ? updated : x,
                                ),
                              }),
                              {
                                id: m.id,
                                type: "void",
                                payload: {},
                                expected_version: m.version,
                              },
                            ],
                          },
                        });
                        notify("Pago anulado y saldo actualizado.");
                        onClose();
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Anular pago
                  </button>
                </div>
              ))}
            </div>
            {debtRemaining(initial).isZero() && (
              <Button
                disabled={busy}
                onClick={async () => {
                  try {
                    await dispatch(
                      planningCommand(state, {
                        ...p,
                        debts: p.debts.map((x) =>
                          x.id === initial.id
                            ? { ...x, archived: !x.archived }
                            : x,
                        ),
                      }),
                    );
                    onClose();
                  } catch (e) {
                    onError((e as Error).message);
                  }
                }}
              >
                {initial.archived
                  ? "Mostrar en deudas"
                  : "Archivar deuda saldada"}
              </Button>
            )}
          </>
        )}
        <ErrorMessage error={error} />
        <div className="dialog-actions">
          <Button type="submit" className="primary full" disabled={busy}>
            Guardar deuda
          </Button>
        </div>
      </form>
    </Modal>
  );
}
function DebtPaymentForm({
  debt,
  onClose,
}: {
  debt: Debt;
  onClose: () => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    p = planningState(state);
  const [baseVersion] = useState(p.version);
  const [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [account, setAccount] = useState(
      state.accounts.find((a) => !a.archived)?.id ?? "",
    ),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title={
        debt.direction === "receivable"
          ? "Registrar cobro de deuda"
          : "Registrar pago de deuda"
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
            if (baseVersion !== p.version)
              throw new Error(
                "Las deudas cambiaron. Vuelve a abrir el formulario de pago.",
              );
            const value = decimal(amount);
            if (D(value).lte(0) || D(value).gt(debtRemaining(debt)))
              throw new Error(
                "El pago debe ser positivo y no superar el saldo pendiente.",
              );
            const m = {
              ...newMovement("adjustment"),
              account_id: account,
              amount_bob: D(value)
                .mul(debt.direction === "receivable" ? 1 : -1)
                .toFixed(),
              occurred_at: atDay(date),
              note: `Pago de deuda · ${debt.name}`,
            };
            const next = {
              ...debt,
              payments: [
                ...debt.payments,
                {
                  id: uid(),
                  amount: value,
                  date,
                  account_id: account,
                  movement_id: m.id,
                },
              ],
            };
            await dispatch({
              id: uid(),
              type: "batch",
              payload: {
                commands: [
                  { id: m.id, type: "movement", payload: m },
                  planningCommand(state, {
                    ...p,
                    debts: p.debts.map((x) => (x.id === debt.id ? next : x)),
                  }),
                ],
              },
            });
            notify("Pago guardado y deuda actualizada.");
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="quiet">
          {debt.name} · Pendiente {money(debtRemaining(debt))}
        </p>
        <Field label="Importe del pago BOB">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </Field>
        <Field label="Cuenta del pago">
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            required
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
        <Field label="Fecha del pago">
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
            Confirmar pago
          </Button>
        </div>
      </form>
    </Modal>
  );
}
