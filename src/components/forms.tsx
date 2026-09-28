"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useFinance } from "./finance-provider";
import { Button, Field, ErrorMessage, Icon, kindNames } from "./ui";
import {
  D,
  decimal,
  atDay,
  localDay,
  today,
  monthNow,
  money,
  units,
  inventory,
  balances,
} from "@/lib/finance";
import { newMovement, uid, emptyState } from "@/lib/demo";
import type {
  Movement,
  Entity,
  Account,
  Category,
  Goal,
  Budget,
  Recurring,
  Profile,
  Quote,
  FinanceState,
} from "@/lib/types";
import type { PaymentMethod } from "@/lib/p2p";
import { AuthResponseError, readAuthResponse } from "@/lib/auth-response";
export function MovementForm({
  initial,
  onClose,
}: {
  initial?: Movement;
  onClose: () => void;
}) {
  const { state, dispatch, notify, mode } = useFinance(),
    editing = Boolean(
      initial && state.movements.some((m) => m.id === initial.id),
    );
  const [form, setForm] = useState<Movement>(
      () =>
        initial ?? {
          ...newMovement(),
          account_id:
            state.accounts.find(
              (a) =>
                a.id === localStorage.getItem(`saldo-last-account-${mode}`) &&
                !a.archived,
            )?.id ??
            state.accounts.find((a) => !a.archived)?.id ??
            null,
        },
    ),
    [amount, setAmount] = useState(initial?.amount_bob ?? ""),
    [quantity, setQuantity] = useState(
      initial?.usdt_quantity === "0" ? "" : (initial?.usdt_quantity ?? ""),
    ),
    [search, setSearch] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const isCrypto = ["buy", "sell", "opening"].includes(form.kind),
    categories = state.categories
      .filter(
        (c) =>
          !c.archived &&
          c.type === form.kind &&
          c.name.toLowerCase().includes(search.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) || a.position - b.position,
      );
  const set = (key: keyof Movement, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  const changeKind = (kind: Movement["kind"]) =>
    setForm((f) => ({
      ...f,
      kind,
      category_id: null,
      destination_id: null,
      fee_bob: "0",
      fee_usdt: "0",
      history_only: false,
    }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const m = {
        ...form,
        amount_bob: form.kind === "opening" && !amount ? null : decimal(amount),
        usdt_quantity: isCrypto ? decimal(quantity) : "0",
        fee_bob: decimal(form.fee_bob),
        fee_usdt: isCrypto ? decimal(form.fee_usdt) : "0",
      };
      await dispatch({
        id: m.id,
        type: "movement",
        payload: m,
        ...(editing ? { expected_version: initial!.version } : {}),
      });
      if (m.account_id)
        localStorage.setItem(`saldo-last-account-${mode}`, m.account_id);
      notify(
        editing
          ? "Movimiento actualizado."
          : mode === "cloud"
            ? "Movimiento guardado. Se sincronizará automáticamente."
            : "Movimiento guardado en este dispositivo.",
        editing
          ? undefined
          : async () => {
              await dispatch({
                id: m.id,
                type: "void",
                payload: {},
                expected_version: 1,
              });
              notify("Movimiento deshecho.");
            },
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Revisa los datos del movimiento.",
      );
    } finally {
      setSaving(false);
    }
  }
  async function voidMovement() {
    setSaving(true);
    try {
      await dispatch({
        id: form.id,
        type: "void",
        payload: {},
        expected_version: initial!.version,
      });
      notify("Movimiento anulado. Los saldos se recalcularon.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form onSubmit={save} className="form-stack">
      <div className="segmented kind-selector">
        {(["expense", "income", "transfer", "buy", "sell"] as const).map(
          (kind) => (
            <button
              type="button"
              className={form.kind === kind ? "active" : ""}
              key={kind}
              onClick={() => changeKind(kind)}
            >
              {kindNames[kind].replace(" de USDT", "")}
            </button>
          ),
        )}
      </div>
      <div className="amount-input">
        <label htmlFor="movement-amount">
          {form.kind === "sell"
            ? "Bolivianos recibidos"
            : form.kind === "buy"
              ? "Bolivianos pagados"
              : form.kind === "adjustment"
                ? "Diferencia de saldo"
                : "Importe en bolivianos"}
        </label>
        <div>
          <span>Bs</span>
          <input
            id="movement-amount"
            name="amount"
            inputMode="decimal"
            autoFocus
            placeholder="0,00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required={form.kind !== "opening"}
            aria-label="Importe en bolivianos"
          />
        </div>
      </div>
      {isCrypto && (
        <Field
          label={form.kind === "sell" ? "USDT vendidos" : "USDT comprados"}
        >
          <input
            inputMode="decimal"
            placeholder="100"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </Field>
      )}
      {["expense", "income"].includes(form.kind) && (
        <div className="category-picker">
          <div className="picker-heading">
            <span>Categoría</span>
            <div className="mini-search">
              <Icon name="Search" size={16} />
              <input
                aria-label="Buscar categoría"
                placeholder="Buscar"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="category-grid">
            {categories.map((c) => (
              <button
                type="button"
                key={c.id}
                className={form.category_id === c.id ? "selected" : ""}
                onClick={() => set("category_id", c.id)}
              >
                <Icon name={c.icon} size={24} style={{ color: c.color }} />
                <span>{c.name.split(" — ")[0]}</span>
                {form.category_id === c.id && (
                  <span className="selection-check">
                    <Icon name="Check" size={12} />
                  </span>
                )}
              </button>
            ))}
          </div>
          {categories.length === 0 && (
            <p className="quiet">
              No hay categorías. Puedes crearlas en Ajustes.
            </p>
          )}
        </div>
      )}
      <div className="form-grid">
        <Field
          label={
            form.kind === "sell" || form.kind === "income"
              ? "Recibir en"
              : "Cuenta"
          }
        >
          <select
            value={form.account_id ?? ""}
            onChange={(e) => set("account_id", e.target.value)}
            required={form.kind !== "opening"}
          >
            <option value="">Seleccionar cuenta</option>
            {state.accounts
              .filter((a) => !a.archived || a.id === form.account_id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Fecha">
          <input
            type="date"
            value={localDay(form.occurred_at)}
            onChange={(e) => set("occurred_at", atDay(e.target.value))}
            required
          />
        </Field>
      </div>
      {form.kind === "transfer" && (
        <Field label="Cuenta de destino">
          <select
            value={form.destination_id ?? ""}
            onChange={(e) => set("destination_id", e.target.value)}
            required
          >
            <option value="">Seleccionar destino</option>
            {state.accounts
              .filter((a) => !a.archived && a.id !== form.account_id)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label="Descripción (opcional)">
        <input
          placeholder={
            form.kind === "expense"
              ? "¿En qué lo usaste?"
              : "Una nota para recordar"
          }
          value={form.note}
          onChange={(e) => set("note", e.target.value)}
          maxLength={1000}
        />
      </Field>
      {(["buy", "sell", "transfer"] as string[]).includes(form.kind) && (
        <details className="form-details">
          <summary>
            Comisiones{isCrypto ? " e historial inicial" : ""}
            <Icon name="ChevronDown" size={16} />
          </summary>
          <div className="form-grid">
            <Field label="Comisión en BOB">
              <input
                inputMode="decimal"
                value={form.fee_bob}
                onChange={(e) => set("fee_bob", e.target.value)}
              />
            </Field>
            {isCrypto && (
              <Field label="Comisión en USDT">
                <input
                  inputMode="decimal"
                  value={form.fee_usdt}
                  onChange={(e) => set("fee_usdt", e.target.value)}
                />
              </Field>
            )}
          </div>
          {isCrypto && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.history_only}
                onChange={(e) => set("history_only", e.target.checked)}
              />
              <span>
                Historial anterior al inicio
                <small>No modifica el saldo inicial del banco.</small>
              </span>
            </label>
          )}
        </details>
      )}
      {isCrypto &&
        /^\d+([.,]\d+)?$/.test(amount) &&
        /^\d+([.,]\d+)?$/.test(quantity) &&
        D(quantity.replace(",", ".") || 0).gt(0) && (
          <div className="form-callout">
            <Icon name="Coins" size={18} />
            <span>
              Tipo de cambio:{" "}
              <strong>
                {money(
                  D(amount.replace(",", ".") || 0).div(
                    quantity.replace(",", "."),
                  ),
                )}{" "}
                / USDT
              </strong>
            </span>
          </div>
        )}
      <ErrorMessage error={error} />
      <Button
        type="submit"
        icon={saving ? "LoaderCircle" : "Check"}
        disabled={saving}
        className="primary full"
      >
        {saving
          ? "Guardando…"
          : editing
            ? "Guardar cambios"
            : "Guardar movimiento"}
      </Button>
      {editing && (
        <button
          type="button"
          className="text-button danger"
          onClick={() => voidMovement()}
          disabled={saving}
        >
          <Icon name="Trash2" size={16} />
          Anular movimiento
        </button>
      )}
    </form>
  );
}
type EntityRecord =
  | Account
  | Category
  | Goal
  | Budget
  | Recurring
  | Profile
  | Quote;
export function EntityForm({
  entity,
  initial,
  onClose,
}: {
  entity: Entity;
  initial?: EntityRecord;
  onClose: () => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false),
    [methods, setMethods] = useState<PaymentMethod[]>([]),
    [methodsError, setMethodsError] = useState("");
  const defaults: Record<Entity, Record<string, unknown>> = {
    account: {
      id: uid(),
      name: "",
      bank_method: "",
      type: "bank",
      opening_balance: "0",
      archived: false,
      version: 1,
    },
    category: {
      id: uid(),
      name: "",
      type: "expense",
      icon: "Shapes",
      color: "#83D6AF",
      favorite: true,
      position: state.categories.length,
      archived: false,
      version: 1,
    },
    goal: {
      id: uid(),
      name: "",
      target_amount: "",
      target_currency: "USDT",
      reserved_usdt: "0",
      due_date: null,
      archived: false,
      version: 1,
    },
    budget: {
      id: uid(),
      category_id:
        state.categories.find((c) => c.type === "expense" && !c.archived)?.id ??
        "",
      month: monthNow(),
      amount: "",
      version: 1,
    },
    recurring: {
      id: uid(),
      name: "",
      amount: "",
      category_id:
        state.categories.find((c) => c.type === "expense" && !c.archived)?.id ??
        "",
      account_id: state.accounts.find((a) => !a.archived)?.id ?? "",
      frequency: "monthly",
      next_date: today(),
      anchor_day: Number(today().slice(8)),
      archived: false,
      version: 1,
    },
    profile: state.profile as unknown as Record<string, unknown>,
    quote: {
      id: uid(),
      price: "",
      observed_at: new Date().toISOString(),
      source: "manual",
      sample_count: 0,
      quantity: state.profile.quote_settings.quantity,
      banks: state.profile.quote_settings.banks,
    },
  };
  const [form, setForm] = useState<Record<string, unknown>>(() =>
    initial ? { ...initial } : defaults[entity],
  );
  const set = (key: string, value: unknown) =>
    setForm((f) => ({ ...f, [key]: value }));
  useEffect(() => {
    if (entity !== "profile" && entity !== "account") return;
    fetch("/api/p2p/methods")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setMethods(data);
        else
          setMethodsError(
            "No pudimos consultar los bancos. Conservaremos tu selección.",
          );
      })
      .catch(() => setMethodsError("Sin conexión al catálogo de bancos."));
  }, [entity]);
  const input = (
    key: string,
    type = "text",
    required = true,
    placeholder = "",
  ) => (
    <input
      type={type}
      inputMode={
        type === "text" &&
        [
          "amount",
          "opening_balance",
          "target_amount",
          "reserved_usdt",
          "price",
        ].includes(key)
          ? "decimal"
          : undefined
      }
      value={String(form[key] ?? "")}
      placeholder={placeholder}
      onChange={(e) => set(key, e.target.value || null)}
      required={required}
    />
  );
  const catSelect = (
    <select
      value={String(form.category_id ?? "")}
      onChange={(e) => set("category_id", e.target.value)}
      required
    >
      <option value="">Seleccionar</option>
      {state.categories
        .filter((c) => c.type === "expense" && !c.archived)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
    </select>
  );
  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = { ...form };
      for (const key of [
        "amount",
        "opening_balance",
        "target_amount",
        "reserved_usdt",
        "price",
      ])
        if (key in payload) payload[key] = decimal(String(payload[key]));
      if (entity === "quote") payload.observed_at = new Date().toISOString();
      if (
        entity === "recurring" &&
        (!initial || (initial as Recurring).next_date !== form.next_date)
      )
        payload.anchor_day = Number(String(form.next_date).slice(8));
      const id = entity === "profile" ? uid() : String(form.id);
      await dispatch({
        id,
        type: "entity",
        entity,
        payload,
        ...(initial && "version" in initial
          ? { expected_version: initial.version }
          : entity === "profile"
            ? { expected_version: state.profile.version }
            : {}),
      });
      notify("Cambios guardados.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revisa los campos.");
    } finally {
      setSaving(false);
    }
  }
  async function archive() {
    try {
      const payload = { ...form, archived: !form.archived };
      await dispatch({
        id: String(form.id),
        type: "entity",
        entity,
        payload,
        expected_version: Number(form.version),
      });
      notify(
        payload.archived
          ? "Archivado. El historial se conserva."
          : "Registro reactivado.",
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <form className="form-stack" onSubmit={save}>
      {["account", "category", "goal", "recurring"].includes(entity) && (
        <Field label="Nombre">
          {input(
            "name",
            "text",
            true,
            entity === "goal"
              ? "Fondo de emergencia"
              : "Un nombre que reconozcas",
          )}
        </Field>
      )}
      {entity === "account" && (
        <>
          <Field label="Tipo de cuenta">
            <select
              value={String(form.type)}
              onChange={(e) => set("type", e.target.value)}
            >
              <option value="bank">Banco</option>
              <option value="cash">Efectivo</option>
            </select>
          </Field>
          {form.type === "bank" && (
            <Field label="Banco para cotizaciones P2P">
              <select
                value={String(form.bank_method)}
                onChange={(e) => set("bank_method", e.target.value)}
              >
                <option value="">Sin asociar</option>
                {String(form.bank_method) &&
                  !methods.some((m) => m.identifier === form.bank_method) && (
                    <option value={String(form.bank_method)}>
                      {String(form.bank_method)}
                    </option>
                  )}
                {methods.map((m) => (
                  <option key={m.identifier} value={m.identifier}>
                    {m.tradeMethodName}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {initial ? (
            <p className="form-callout">
              Saldo inicial: {money(String(form.opening_balance))}. Para
              corregir el saldo actual, usa Conciliar.
            </p>
          ) : (
            <Field label="Saldo inicial en bolivianos">
              {input("opening_balance")}
            </Field>
          )}
          {methodsError && <small className="quiet">{methodsError}</small>}
        </>
      )}
      {entity === "category" && (
        <>
          <div className="form-grid">
            <Field label="Tipo">
              <select
                value={String(form.type)}
                onChange={(e) => set("type", e.target.value)}
                disabled={Boolean(
                  initial &&
                  state.movements.some(
                    (m) => m.category_id === (initial as Category).id,
                  ),
                )}
              >
                <option value="expense">Gasto</option>
                <option value="income">Ingreso</option>
              </select>
            </Field>
            <Field label="Orden">
              <input
                type="number"
                min={0}
                value={Number(form.position)}
                onChange={(e) => set("position", Number(e.target.value))}
              />
            </Field>
          </div>
          <Field label="Icono">
            <div className="icon-picker">
              {[
                "Dumbbell",
                "Utensils",
                "ShoppingBasket",
                "Gamepad2",
                "Zap",
                "Car",
                "HeartPulse",
                "House",
                "Shapes",
                "BriefcaseBusiness",
                "Laptop",
                "Plane",
              ].map((icon) => (
                <button
                  type="button"
                  key={icon}
                  aria-label={icon}
                  onClick={() => set("icon", icon)}
                  className={form.icon === icon ? "selected" : ""}
                >
                  <Icon name={icon} />
                </button>
              ))}
            </div>
          </Field>
          <Field label="Color">
            <div className="color-picker">
              {[
                "#83D6AF",
                "#E8B78E",
                "#B8A6D9",
                "#9EAEEE",
                "#E6C478",
                "#A7C4D5",
                "#F29B9B",
                "#B5B7BC",
              ].map((color) => (
                <button
                  type="button"
                  key={color}
                  style={{ background: color }}
                  aria-label={color}
                  onClick={() => set("color", color)}
                  className={form.color === color ? "selected" : ""}
                >
                  {form.color === color && <Icon name="Check" size={18} />}
                </button>
              ))}
            </div>
          </Field>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={Boolean(form.favorite)}
              onChange={(e) => set("favorite", e.target.checked)}
            />
            Mostrar en categorías favoritas
          </label>
        </>
      )}
      {entity === "goal" && (
        <>
          <div className="form-grid">
            <Field label="Objetivo">{input("target_amount")}</Field>
            <Field label="Moneda del objetivo">
              <select
                value={String(form.target_currency)}
                onChange={(e) => set("target_currency", e.target.value)}
              >
                <option value="USDT">USDT</option>
                <option value="BOB">BOB</option>
              </select>
            </Field>
          </div>
          <Field
            label="USDT reservados en esta meta"
            hint={`Saldo total en Binance: ${units(inventory(state.movements).quantity)} USDT. Reservar no crea ingresos ni gastos.`}
          >
            {input("reserved_usdt")}
          </Field>
          <Field label="Fecha objetivo (opcional)">
            {input("due_date", "date", false)}
          </Field>
        </>
      )}
      {entity === "budget" && (
        <>
          <Field label="Categoría">{catSelect}</Field>
          <div className="form-grid">
            <Field label="Mes">{input("month", "month")}</Field>
            <Field label="Límite mensual en BOB">{input("amount")}</Field>
          </div>
          <p className="quiet">
            Recibirás avisos al alcanzar el 80 % y 100 %. Cada mes comienza un
            presupuesto nuevo.
          </p>
        </>
      )}
      {entity === "recurring" && (
        <>
          <Field label="Importe en BOB">{input("amount")}</Field>
          <Field label="Categoría">{catSelect}</Field>
          <Field label="Cuenta">
            <select
              value={String(form.account_id ?? "")}
              onChange={(e) => set("account_id", e.target.value)}
            >
              {state.accounts
                .filter((a) => !a.archived)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </select>
          </Field>
          <div className="form-grid">
            <Field label="Frecuencia">
              <select
                value={String(form.frequency)}
                onChange={(e) => set("frequency", e.target.value)}
              >
                <option value="monthly">Mensual</option>
                <option value="weekly">Semanal</option>
                <option value="yearly">Anual</option>
              </select>
            </Field>
            <Field label="Próximo pago">{input("next_date", "date")}</Field>
          </div>
          <p className="form-callout">
            El saldo cambiará cuando confirmes que pagaste.
          </p>
        </>
      )}
      {entity === "quote" && (
        <>
          <Field label="Referencia manual BOB por USDT">
            {input("price", "text", true, "9,45")}
          </Field>
          <p className="form-callout">
            Esta referencia se identificará como manual y conservará su fecha.
            No se presentará como cotización automática.
          </p>
        </>
      )}
      {entity === "profile" && (
        <>
          <Field label="Tu nombre">{input("display_name")}</Field>
          <QuotePreferences
            value={form.quote_settings as Profile["quote_settings"]}
            methods={methods}
            onChange={(value) => set("quote_settings", value)}
          />
          {methodsError && <small className="quiet">{methodsError}</small>}
        </>
      )}
      <ErrorMessage error={error} />
      <Button
        type="submit"
        className="primary full"
        icon={saving ? "LoaderCircle" : "Check"}
        disabled={saving}
      >
        {saving ? "Guardando…" : "Guardar"}
      </Button>
      {initial && "archived" in initial && (
        <button type="button" className="text-button" onClick={() => archive()}>
          {form.archived ? "Reactivar" : "Archivar y conservar historial"}
        </button>
      )}
    </form>
  );
}
function QuotePreferences({
  value,
  methods,
  onChange,
}: {
  value: Profile["quote_settings"];
  methods: PaymentMethod[];
  onChange: (s: Profile["quote_settings"]) => void;
}) {
  return (
    <>
      <Field label="Monto de referencia en USDT">
        <input
          inputMode="decimal"
          value={value.quantity}
          onChange={(e) =>
            onChange({ ...value, quantity: e.target.value.replace(",", ".") })
          }
          required
        />
      </Field>
      <div className="field">
        <span>Bancos compatibles</span>
        <div className="bank-checkboxes">
          {methods.map((m) => (
            <label key={m.identifier} className="checkbox-row">
              <input
                type="checkbox"
                checked={value.banks.includes(m.identifier)}
                onChange={(e) =>
                  onChange({
                    ...value,
                    banks: e.target.checked
                      ? [...value.banks, m.identifier]
                      : value.banks.filter((b) => b !== m.identifier),
                  })
                }
              />
              {m.tradeMethodName}
            </label>
          ))}
        </div>
        <small>
          Sin selección se consideran todos los métodos disponibles.
        </small>
      </div>
      <details className="form-details">
        <summary>
          Calidad de los comerciantes
          <Icon name="ChevronDown" size={16} />
        </summary>
        <Field label="Operaciones mensuales mínimas">
          <input
            type="number"
            min={0}
            value={value.min_orders}
            onChange={(e) =>
              onChange({ ...value, min_orders: Number(e.target.value) })
            }
          />
        </Field>
        <div className="form-grid">
          <Field label="Finalización mínima (%)">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(value.min_completion * 100)}
              onChange={(e) =>
                onChange({
                  ...value,
                  min_completion: Number(e.target.value) / 100,
                })
              }
            />
          </Field>
          <Field label="Valoración positiva (%)">
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round(value.min_positive * 100)}
              onChange={(e) =>
                onChange({
                  ...value,
                  min_positive: Number(e.target.value) / 100,
                })
              }
            />
          </Field>
        </div>
      </details>
    </>
  );
}
type HistoryRow = {
  id: string;
  kind: "buy" | "sell";
  date: string;
  bob: string;
  quantity: string;
};
export function Onboarding({ onClose }: { onClose: () => void }) {
  const { dispatch, notify } = useFinance(),
    [step, setStep] = useState(0),
    [name, setName] = useState(""),
    [cutoff, setCutoff] = useState(today()),
    [accounts, setAccounts] = useState([
      {
        id: uid(),
        name: "Banco Nacional de Bolivia",
        type: "bank" as const,
        opening_balance: "0",
        bank_method: "BancoDeBolivia",
      },
      {
        id: uid(),
        name: "Efectivo",
        type: "cash" as const,
        opening_balance: "0",
        bank_method: "",
      },
    ]),
    [usdt, setUsdt] = useState("0"),
    [cost, setCost] = useState(""),
    [history, setHistory] = useState<HistoryRow[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const updateAccount = (i: number, key: string, value: string) =>
    setAccounts((list) =>
      list.map((a, j) => (j === i ? { ...a, [key]: value } : a)),
    );
  async function finish() {
    setError("");
    setBusy(true);
    try {
      const s = emptyState();
      s.categories = s.categories.map((c) => ({ ...c, id: uid() }));
      s.profile = {
        ...s.profile,
        display_name: name || "Mi espacio",
        cutoff,
        onboarded: true,
      };
      s.accounts = accounts.map((a) => ({
        ...a,
        opening_balance: decimal(a.opening_balance),
        archived: false,
        version: 1,
      }));
      if (!s.accounts.length || s.accounts.some((a) => !a.name.trim()))
        throw new Error("Añade al menos una cuenta con nombre.");
      const q = decimal(usdt);
      if (D(q).lt(0)) throw new Error("El saldo USDT no puede ser negativo.");
      if (history.length) {
        s.movements = history.map((h) => ({
          ...newMovement(h.kind),
          id: h.id,
          account_id: s.accounts[0].id,
          amount_bob: decimal(h.bob),
          usdt_quantity: decimal(h.quantity),
          occurred_at: atDay(h.date),
          history_only: true,
          note: "Historial inicial",
        }));
        if (!D(inventory(s.movements).quantity).eq(q))
          throw new Error(
            `El historial suma ${units(inventory(s.movements).quantity)} USDT. Debe coincidir con tu saldo actual (${units(q)}).`,
          );
      } else if (D(q).gt(0))
        s.movements = [
          {
            ...newMovement("opening"),
            amount_bob: cost ? decimal(cost) : null,
            usdt_quantity: q,
            occurred_at: atDay(cutoff),
            history_only: true,
            note: "Saldo inicial Binance",
          },
        ];
      await dispatch({
        id: uid(),
        type: "bootstrap",
        payload: s as unknown as Record<string, unknown>,
      });
      notify("Tu espacio está listo. Empieza con tu primer movimiento.");
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-stack">
      <div className="onboarding-steps">
        {["Tu espacio", "Tus cuentas", "Tu ahorro"].map((s, i) => (
          <span
            key={s}
            className={i === step ? "current" : i < step ? "done" : ""}
          >
            {i < step ? <Icon name="Check" size={14} /> : i + 1}
            <small>{s}</small>
          </span>
        ))}
      </div>
      {step === 0 && (
        <>
          <div className="onboarding-intro">
            <div className="orb small">
              <Icon name="Wallet" size={34} />
            </div>
            <h3>Empecemos desde donde estás.</h3>
            <p>
              Tus saldos actuales serán el punto de partida. No necesitas
              reconstruir todos tus gastos.
            </p>
          </div>
          <Field label="¿Cómo te llamas?">
            <input
              autoFocus
              placeholder="Tu nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </Field>
          <Field label="Fecha de inicio">
            <input
              type="date"
              value={cutoff}
              max={today()}
              onChange={(e) => setCutoff(e.target.value)}
              required
            />
          </Field>
        </>
      )}
      {step === 1 && (
        <>
          <p className="quiet">
            Registra el saldo de cada cuenta en la fecha de inicio, en
            bolivianos. Puedes añadir más cuentas después.
          </p>
          {accounts.map((a, i) => (
            <div className="onboarding-account" key={a.id}>
              <div className="form-grid">
                <Field label="Nombre de la cuenta">
                  <input
                    value={a.name}
                    onChange={(e) => updateAccount(i, "name", e.target.value)}
                    required
                  />
                </Field>
                <Field label="Saldo inicial (BOB)">
                  <input
                    inputMode="decimal"
                    value={a.opening_balance}
                    onChange={(e) =>
                      updateAccount(i, "opening_balance", e.target.value)
                    }
                    required
                  />
                </Field>
              </div>
              {accounts.length > 1 && (
                <button
                  className="text-button"
                  onClick={() =>
                    setAccounts((list) => list.filter((x) => x.id !== a.id))
                  }
                >
                  Quitar cuenta
                </button>
              )}
            </div>
          ))}
          <Button
            icon="Plus"
            onClick={() =>
              setAccounts((list) => [
                ...list,
                {
                  id: uid(),
                  name: "",
                  type: "bank",
                  opening_balance: "0",
                  bank_method: "",
                },
              ])
            }
          >
            Añadir banco
          </Button>
        </>
      )}
      {step === 2 && (
        <>
          <Field label="Tu saldo actual en Binance (USDT)">
            <input
              inputMode="decimal"
              value={usdt}
              onChange={(e) => setUsdt(e.target.value)}
            />
          </Field>
          {history.length === 0 && (
            <Field
              label="Costo total en BOB (opcional)"
              hint="Si lo dejas vacío, se mostrará Costo incompleto. Puedes reconstruir tus compras para usar FIFO por lote."
            >
              <input
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Si conoces cuánto pagaste"
              />
            </Field>
          )}
          <details className="form-details">
            <summary>
              Reconstruir compras y ventas anteriores
              <Icon name="ChevronDown" size={16} />
            </summary>
            <p className="quiet">
              Estas operaciones reconstruyen tus lotes y no descuentan dinero de
              los bancos. El saldo resultante debe coincidir con el de Binance.
            </p>
            {history.map((h, i) => (
              <div className="history-row" key={h.id}>
                <div className="form-grid">
                  <Field label="Operación">
                    <select
                      value={h.kind}
                      onChange={(e) =>
                        setHistory((rows) =>
                          rows.map((x, j) =>
                            j === i
                              ? { ...x, kind: e.target.value as "buy" | "sell" }
                              : x,
                          ),
                        )
                      }
                    >
                      <option value="buy">Compra</option>
                      <option value="sell">Venta</option>
                    </select>
                  </Field>
                  <Field label="Fecha">
                    <input
                      type="date"
                      value={h.date}
                      max={cutoff}
                      onChange={(e) =>
                        setHistory((rows) =>
                          rows.map((x, j) =>
                            j === i ? { ...x, date: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="USDT">
                    <input
                      inputMode="decimal"
                      value={h.quantity}
                      onChange={(e) =>
                        setHistory((rows) =>
                          rows.map((x, j) =>
                            j === i ? { ...x, quantity: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Total BOB">
                    <input
                      inputMode="decimal"
                      value={h.bob}
                      onChange={(e) =>
                        setHistory((rows) =>
                          rows.map((x, j) =>
                            j === i ? { ...x, bob: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setHistory((rows) => rows.filter((x) => x.id !== h.id))
                  }
                >
                  Quitar operación
                </button>
              </div>
            ))}
            <Button
              icon="Plus"
              onClick={() =>
                setHistory((rows) => [
                  ...rows,
                  {
                    id: uid(),
                    kind: "buy",
                    date: cutoff,
                    bob: "",
                    quantity: "",
                  },
                ])
              }
            >
              Añadir operación histórica
            </Button>
          </details>
          <p className="form-callout">
            <Icon name="CheckCircle2" size={18} />
            Tus categorías ya están listas. Personaliza presupuestos y metas
            desde Ajustes y Binance.
          </p>
        </>
      )}
      <ErrorMessage error={error} />
      <div className="form-actions">
        {step > 0 && (
          <Button
            icon="ArrowLeft"
            onClick={() => {
              setError("");
              setStep(step - 1);
            }}
          >
            Atrás
          </Button>
        )}
        <Button
          className="primary grow"
          icon={step === 2 ? "Check" : "ArrowRight"}
          disabled={busy}
          onClick={() => {
            if (step < 2) {
              setError("");
              setStep(step + 1);
            } else void finish();
          }}
        >
          {busy ? "Preparando…" : step === 2 ? "Crear mi espacio" : "Continuar"}
        </Button>
      </div>
    </div>
  );
}
export function ReconcileForm({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { state, dispatch, notify } = useFinance(),
    current = balances(state)[account.id],
    [amount, setAmount] = useState(current),
    [note, setNote] = useState("Conciliación de saldo"),
    [error, setError] = useState("");
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const delta = D(decimal(amount)).minus(current);
          if (delta.isZero()) throw new Error("El saldo ya coincide.");
          const m = {
            ...newMovement("adjustment"),
            account_id: account.id,
            amount_bob: delta.toFixed(2),
            note,
          };
          await dispatch({ id: m.id, type: "movement", payload: m });
          notify("Saldo conciliado con un ajuste trazable.");
          onClose();
        } catch (e) {
          setError((e as Error).message);
        }
      }}
    >
      <p className="form-callout">
        Saldo registrado: <strong>{money(current)}</strong>
      </p>
      <Field label="Saldo real en tu banco o billetera">
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
          autoFocus
        />
      </Field>
      <Field label="Motivo">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          required
        />
      </Field>
      <p className="quiet">
        Se guardará la diferencia como un ajuste. No contará como ingreso ni
        gasto.
      </p>
      <ErrorMessage error={error} />
      <Button className="primary full" type="submit" icon="Check">
        Conciliar saldo
      </Button>
    </form>
  );
}
export function AuthForm() {
  const { refreshAuth, switchMode } = useFinance(),
    [signup, setSignup] = useState(false),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmation, setConfirmation] = useState(false),
    [requiresVercel, setRequiresVercel] = useState(false);
  return (
    <div className="auth-screen">
      <div className="auth-art">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          saldo<span>.</span>
        </div>
        <h1>
          Tu dinero,
          <br />
          <span>con perspectiva.</span>
        </h1>
        <p>
          Un lugar para tus cuentas, tus gastos
          <br />y eso que estás construyendo.
        </p>
        <div className="auth-orbit" />
        <span className="auth-location">PENSADO PARA BOLIVIA · BOB / USDT</span>
      </div>
      <form
        className="auth-form form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          setRequiresVercel(false);
          setConfirmation(false);
          try {
            const response = await fetch("/api/auth", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email,
                password,
                action: signup ? "signup" : "signin",
              }),
            });
            const result = await readAuthResponse(response);
            if (result.confirmation) setConfirmation(true);
            else await refreshAuth();
          } catch (e) {
            setRequiresVercel(
              e instanceof AuthResponseError && e.requiresVercel,
            );
            setError(
              e instanceof AuthResponseError
                ? e.message
                : "No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <p className="eyebrow">TU ESPACIO PERSONAL</p>
          <h2>{signup ? "Crea tu acceso" : "Qué bueno verte."}</h2>
          <p className="quiet">
            {signup
              ? "Comienza a cuidar tus finanzas."
              : "Inicia sesión para volver a tus finanzas."}
          </p>
        </div>
        <Field label="Correo electrónico">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <Field label="Contraseña">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={signup ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </Field>
        <ErrorMessage error={error} />
        {requiresVercel && (
          <Button className="full" onClick={() => window.location.reload()}>
            Autorizar acceso
          </Button>
        )}
        {confirmation && (
          <p className="form-callout">
            Revisa tu correo para confirmar el acceso antes de iniciar sesión.
          </p>
        )}
        <Button
          type="submit"
          className="primary full"
          icon="ArrowRight"
          disabled={busy}
        >
          {busy
            ? "Conectando…"
            : signup
              ? "Crear acceso"
              : "Entrar a mi espacio"}
        </Button>
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setSignup(!signup);
            setError("");
            setRequiresVercel(false);
            setConfirmation(false);
          }}
        >
          {signup ? "Ya tengo una cuenta" : "Crear mi acceso"}
        </button>
        <div className="auth-divider">o explora antes</div>
        <Button className="full" onClick={() => void switchMode("demo")}>
          Probar la demostración
        </Button>
      </form>
    </div>
  );
}
