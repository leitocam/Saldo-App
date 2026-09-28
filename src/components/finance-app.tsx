"use client";
import { useEffect, useMemo, useState } from "react";
import { useFinance } from "./finance-provider";
import {
  AuthForm,
  EntityForm,
  MovementForm,
  Onboarding,
  ReconcileForm,
} from "./forms";
import {
  BinanceMark,
  Button,
  Empty,
  Icon,
  Modal,
  MovementRow,
  SectionHead,
  kindNames,
} from "./ui";
import { Donut, MonthlyChart, Sparkline } from "./charts";
import {
  D,
  balances,
  csv,
  displayDate,
  inventory,
  latestQuote,
  localDay,
  money,
  monthNow,
  monthRange,
  nextDue,
  previousMonth,
  quoteStale,
  report,
  reserved,
  today,
  units,
  atDay,
} from "@/lib/finance";
import { newMovement, uid } from "@/lib/demo";
import { cloudConfigured } from "@/lib/supabase/browser";
import type {
  Account,
  Budget,
  Category,
  Entity,
  FinanceState,
  Goal,
  Movement,
  Profile,
  Quote,
  Recurring,
} from "@/lib/types";
type Page = "home" | "movements" | "accounts" | "binance" | "reports";
type ModalState =
  | { type: "movement"; initial?: Movement }
  | {
      type: "entity";
      entity: Entity;
      initial?:
        | Account
        | Category
        | Goal
        | Budget
        | Recurring
        | Profile
        | Quote;
    }
  | { type: "settings" }
  | { type: "onboarding" }
  | { type: "reconcile"; account: Account }
  | { type: "sync" }
  | null;
const nav: { id: Page; label: string; icon: string }[] = [
  { id: "home", label: "Inicio", icon: "LayoutDashboard" },
  { id: "movements", label: "Movimientos", icon: "ArrowLeftRight" },
  { id: "accounts", label: "Cuentas", icon: "Wallet" },
  { id: "binance", label: "Binance", icon: "Coins" },
  { id: "reports", label: "Reportes", icon: "ChartNoAxesCombined" },
];
const titles: Record<Page, [string, string]> = {
  home: [
    "Tu dinero, con perspectiva.",
    "Un vistazo a lo que tienes y a lo que estás construyendo.",
  ],
  movements: [
    "Cada movimiento cuenta.",
    "Tu día a día, sin perder el detalle.",
  ],
  accounts: [
    "Todo en su lugar.",
    "Tus bancos y efectivo, en un mismo espacio.",
  ],
  binance: [
    "Tu ahorro, más claro.",
    "Conoce el costo de tus USDT y cómo cambia su valor.",
  ],
  reports: [
    "Entiende tus números.",
    "Una mirada más amplia para tomar mejores decisiones.",
  ],
};
export function FinanceApp() {
  const ctx = useFinance(),
    { state, ready, mode, online, pending, authRequired, notify } = ctx;
  const [page, setPage] = useState<Page>("home"),
    [month, setMonth] = useState(monthNow),
    [modal, setModal] = useState<ModalState>(null),
    [filterAccount, setFilterAccount] = useState(""),
    [filterCategory, setFilterCategory] = useState(""),
    [filterPeriod, setFilterPeriod] = useState<{
      from: string;
      to: string;
    } | null>(null),
    [hidden, setHidden] = useState(false),
    [settingsTab, setSettingsTab] = useState("categories"),
    [quoteBusy, setQuoteBusy] = useState(false),
    [quoteError, setQuoteError] = useState(""),
    [sessionBusy, setSessionBusy] = useState(false);
  const b = useMemo(() => balances(state), [state]),
    wallet = useMemo(() => inventory(state.movements), [state.movements]),
    quote = latestQuote(state),
    range = monthRange(month),
    summary = report(state, range.from, range.to),
    cash = Object.values(b).reduce((sum, v) => sum.plus(v), D(0)),
    saved = reserved(state),
    valuation = quote ? D(wallet.quantity).mul(quote.price) : null;
  const available = D(wallet.quantity).minus(saved),
    knownValue = quote
      ? D(wallet.quantity).minus(wallet.unknown_quantity).mul(quote.price)
      : null,
    unrealized = knownValue?.minus(wallet.known_cost),
    pendingIds = new Set(pending.map((p) => p.command.id));
  const changePage = (next: Page) => {
    setPage(next);
    setFilterAccount("");
    setFilterCategory("");
    setFilterPeriod(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const edit = (m: Movement) => setModal({ type: "movement", initial: m });
  const leaveWorkspace = async () => {
    if (sessionBusy) return;
    setSessionBusy(true);
    try {
      if (mode === "demo") await ctx.exitDemo();
      else await ctx.signOut();
      setModal(null);
      changePage("home");
    } catch (e) {
      notify(
        e instanceof Error
          ? e.message
          : "No se pudo salir. Inténtalo de nuevo.",
      );
    } finally {
      setSessionBusy(false);
    }
  };
  const entity = (
    e: Entity,
    initial?: Account | Category | Goal | Budget | Recurring | Profile | Quote,
  ) => setModal({ type: "entity", entity: e, initial });
  const register = (kind: Movement["kind"] = "expense") => {
    if (!state.accounts.some((a) => !a.archived)) {
      notify("Añade una cuenta para registrar movimientos.");
      entity("account");
      return;
    }
    setModal({
      type: "movement",
      initial: {
        ...newMovement(kind),
        account_id:
          state.accounts.find(
            (a) =>
              !a.archived &&
              a.id === localStorage.getItem(`saldo-last-account-${mode}`),
          )?.id ??
          state.accounts.find((a) => !a.archived)?.id ??
          null,
      },
    });
  };
  async function refreshQuote() {
    if (!online) {
      setQuoteError("Sin conexión. Se conserva la última referencia.");
      return;
    }
    setQuoteBusy(true);
    setQuoteError("");
    try {
      const r = await fetch("/api/p2p/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(state.profile.quote_settings),
        }),
        data = await r.json();
      if (!r.ok) throw new Error(data.error);
      if (data.quote) {
        const q = data.quote as Quote;
        await ctx.dispatch({
          id: q.id,
          type: "entity",
          entity: "quote",
          payload: q,
        });
        notify("Referencia P2P actualizada.");
      } else setQuoteError(data.message);
    } catch (e) {
      setQuoteError((e as Error).message);
    } finally {
      setQuoteBusy(false);
    }
  }
  useEffect(() => {
    if (page !== "binance") return;
    void refreshQuote();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refreshQuote();
    }, 300000);
    return () =>
      clearInterval(
        interval,
      ); /* Preferences changes restart the foreground refresh. */
  }, [page, online, JSON.stringify(state.profile.quote_settings)]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirmRecurring = async (r: Recurring) => {
    try {
      const key = `${r.id}:${r.next_date}`;
      if (!state.movements.some((m) => m.recurring_key === key && !m.voided)) {
        const m = {
          ...newMovement("expense"),
          account_id: r.account_id,
          category_id: r.category_id,
          amount_bob: r.amount,
          occurred_at: atDay(today()),
          note: r.name,
          recurring_key: key,
        };
        await ctx.dispatch({ id: m.id, type: "movement", payload: m });
      }
      notify("Pago confirmado y próxima fecha preparada.");
    } catch (e) {
      notify((e as Error).message);
    }
  };
  const showFiltered = (
    account = "",
    category = "",
    period: { from: string; to: string } | null = null,
  ) => {
    changePage("movements");
    setFilterAccount(account);
    setFilterCategory(category);
    setFilterPeriod(period);
  };
  const recent = state.movements
    .filter((m) => !m.voided && !m.history_only)
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
    .slice(0, 5);
  if (!ready)
    return (
      <div className="loading-screen">
        <div className="brand">
          <img src="/icon.svg" alt="" />
          saldo<span>.</span>
        </div>
        <Icon name="LoaderCircle" className="spin" />
        <p>Preparando tu espacio…</p>
      </div>
    );
  if (authRequired) return <AuthForm />;
  const entityTitles: Record<Entity, string> = {
    account: "Tu cuenta",
    category: "Tu categoría",
    goal: "Tu meta de ahorro",
    budget: "Tu presupuesto",
    recurring: "Tu pago recurrente",
    profile: "Preferencias de tu espacio",
    quote: "Referencia manual",
  };
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Saltar al contenido
      </a>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            changePage("home");
          }}
        >
          <img src="/icon.svg" alt="" />
          saldo<span>.</span>
        </a>
        <div className="workspace-label">
          <span className="status-dot" />
          MI ESPACIO PERSONAL
        </div>
        <nav aria-label="Navegación principal">
          {nav.map((n) => (
            <button
              key={n.id}
              className={page === n.id ? "active" : ""}
              onClick={() => changePage(n.id)}
              aria-current={page === n.id ? "page" : undefined}
            >
              {n.id === "binance" ? (
                <BinanceMark size={20} />
              ) : (
                <Icon name={n.icon} />
              )}
              <span>{n.label}</span>
              {page === n.id && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Icon name="ShieldCheck" size={22} />
            <strong>Un poco más de claridad.</strong>
            <p>Un movimiento a la vez.</p>
          </div>
          <button
            className="settings-link"
            onClick={() => setModal({ type: "settings" })}
          >
            <Icon name="Settings2" />
            <span>Ajustes y categorías</span>
          </button>
          <div className="sidebar-profile">
            <span className="avatar">
              {state.profile.display_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{state.profile.display_name}</strong>
              <small>
                {mode === "demo"
                  ? "Espacio de demostración"
                  : mode === "cloud"
                    ? "Espacio privado"
                    : "Espacio en este dispositivo"}
              </small>
            </div>
            <button
              className="icon-btn"
              aria-label="Preferencias del perfil"
              onClick={() => entity("profile", state.profile)}
            >
              <Icon name="MoreHorizontal" />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-wrapper">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Mi espacio</span>
            <Icon name="ChevronRight" size={14} />
            <strong>{nav.find((n) => n.id === page)?.label}</strong>
          </div>
          <a
            className="mobile-brand brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              changePage("home");
            }}
          >
            saldo<span>.</span>
          </a>
          <div className="topbar-actions">
            <button
              className={`connection-chip ${!online || pending.length ? "warning" : ""}`}
              aria-label={`Estado de conexión: ${!online ? "sin conexión" : pending.length ? `${pending.length} pendientes` : mode === "cloud" ? "sincronizado" : mode === "demo" ? "demostración" : "guardado local"}`}
              onClick={() => setModal({ type: "sync" })}
            >
              <Icon
                name={
                  !online ? "WifiOff" : mode === "cloud" ? "Cloud" : "CloudOff"
                }
                size={14}
              />
              <span>
                {!online
                  ? "Sin conexión"
                  : pending.length
                    ? `${pending.length} pendientes`
                    : mode === "demo"
                      ? "Demostración"
                      : mode === "cloud"
                        ? "Sincronizado"
                        : "Guardado local"}
              </span>
            </button>
            {(mode === "demo" || mode === "cloud") && (
              <button
                className="session-exit"
                type="button"
                disabled={sessionBusy}
                onClick={() => void leaveWorkspace()}
              >
                <Icon name="LogOut" size={16} />
                <span>
                  {mode === "demo" ? "Salir de la demo" : "Cerrar sesión"}
                </span>
              </button>
            )}
            <button
              className="icon-btn mobile-settings"
              aria-label="Ajustes"
              onClick={() => setModal({ type: "settings" })}
            >
              <Icon name="Settings2" />
            </button>
            <button
              className="avatar top-avatar"
              aria-label="Abrir preferencias"
              onClick={() => entity("profile", state.profile)}
            >
              {state.profile.display_name.slice(0, 1).toUpperCase()}
            </button>
          </div>
        </header>
        <main id="main-content" className="main-content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {page === "home"
                  ? `HOLA, ${state.profile.display_name.toUpperCase()}`
                  : page === "binance"
                    ? "BOB / USDT · FIFO"
                    : "TU ESPACIO FINANCIERO"}
              </p>
              <h1>{titles[page][0]}</h1>
              <p className="page-subtitle">{titles[page][1]}</p>
            </div>
            <div className="heading-actions">
              {page !== "accounts" && page !== "binance" && (
                <label className="month-picker">
                  <Icon name="CalendarDays" size={17} />
                  <input
                    type="month"
                    aria-label="Mes del resumen"
                    value={month}
                    onChange={(e) => {
                      if (e.target.value) setMonth(e.target.value);
                    }}
                  />
                </label>
              )}
              <Button
                icon="Plus"
                className="primary register-desktop"
                onClick={() => register()}
              >
                Registrar
              </Button>
            </div>
          </div>
          {(mode === "demo" || !state.profile.onboarded) && (
            <div className="demo-banner">
              <span>
                <Icon name={mode === "demo" ? "Shapes" : "Wallet"} size={16} />
                {mode === "demo" ? (
                  <>
                    Estás explorando con datos de ejemplo.{" "}
                    <span className="banner-detail">
                      Tu espacio empieza con tus propios números.
                    </span>
                  </>
                ) : (
                  <>Tu espacio está listo para configurar.</>
                )}
              </span>
              <button
                onClick={async () => {
                  if (mode === "demo") await ctx.switchMode("local");
                  setModal({ type: "onboarding" });
                }}
              >
                Configurar mis cuentas
                <Icon name="ArrowRight" size={15} />
              </button>
            </div>
          )}
          {page === "home" && (
            <div className="page-enter">
              <div className="overview-grid">
                <section className="wealth-card">
                  <div className="wealth-top">
                    <span>
                      <span className="status-dot" />
                      PATRIMONIO ESTIMADO
                    </span>
                    <button
                      className="icon-btn"
                      aria-label={hidden ? "Mostrar saldos" : "Ocultar saldos"}
                      onClick={() => setHidden(!hidden)}
                    >
                      <Icon name={hidden ? "EyeOff" : "Eye"} size={18} />
                    </button>
                  </div>
                  <div className="wealth-value">
                    {hidden
                      ? "••••••"
                      : quote || D(wallet.quantity).isZero()
                        ? money(cash.plus(valuation ?? 0))
                        : money(cash)}
                    <span>BOB</span>
                  </div>
                  <p>
                    {quoteStale(quote) && D(wallet.quantity).gt(0)
                      ? "Valoración con la última referencia disponible"
                      : !quote && D(wallet.quantity).gt(0)
                        ? "Bancos y efectivo · USDT pendiente de valorar"
                        : "Tu dinero en bancos, efectivo y USDT"}
                  </p>
                  <div className="wealth-breakdown">
                    <div>
                      <span>Bancos y efectivo</span>
                      <strong>{hidden ? "••••" : money(cash)}</strong>
                    </div>
                    <div>
                      <span>Binance · estimado</span>
                      <strong>
                        {hidden
                          ? "••••"
                          : valuation
                            ? money(valuation)
                            : D(wallet.quantity).isZero()
                              ? money(0)
                              : "Sin referencia"}
                      </strong>
                    </div>
                  </div>
                  <div className="wealth-decoration" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </section>
                <section className="month-card">
                  <div className="card-label">
                    <Icon name="ChartNoAxesCombined" size={18} />
                    <span>Tu mes en números</span>
                  </div>
                  <div className="month-number">
                    <span>Diferencia del mes</span>
                    <strong>{hidden ? "••••" : money(summary.net)}</strong>
                  </div>
                  <div className="month-stats">
                    <div>
                      <span className="stat-icon positive">
                        <Icon name="ArrowDownLeft" size={17} />
                      </span>
                      <div>
                        <small>Ingresos</small>
                        <strong>
                          {hidden ? "••••" : money(summary.income)}
                        </strong>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon expense">
                        <Icon name="ArrowUpRight" size={17} />
                      </span>
                      <div>
                        <small>Gastos</small>
                        <strong>
                          {hidden ? "••••" : money(summary.expense)}
                        </strong>
                      </div>
                    </div>
                  </div>
                  <button
                    className="card-link"
                    onClick={() => changePage("reports")}
                  >
                    Ver cómo va tu mes
                    <Icon name="ArrowRight" size={16} />
                  </button>
                </section>
              </div>
              <div className="quick-actions">
                <button onClick={() => register("expense")}>
                  <span>
                    <Icon name="ArrowUpRight" />
                  </span>
                  Registrar gasto
                </button>
                <button onClick={() => register("income")}>
                  <span>
                    <Icon name="ArrowDownLeft" />
                  </span>
                  Registrar ingreso
                </button>
                <button onClick={() => register("transfer")}>
                  <span>
                    <Icon name="ArrowLeftRight" />
                  </span>
                  Transferir
                </button>
                <button onClick={() => register("buy")}>
                  <span>
                    <BinanceMark size={21} />
                  </span>
                  Comprar USDT
                </button>
              </div>
              <section className="accounts-preview">
                <SectionHead title="Tus cuentas">
                  <button
                    className="text-button"
                    onClick={() => changePage("accounts")}
                  >
                    Ver todas
                    <Icon name="ArrowRight" size={15} />
                  </button>
                </SectionHead>
                <div className="account-strip">
                  {state.accounts
                    .filter((a) => !a.archived)
                    .slice(0, 3)
                    .map((a) => (
                      <button
                        className="account-preview"
                        key={a.id}
                        onClick={() => showFiltered(a.id)}
                      >
                        <span
                          className={`bank-logo ${a.type === "cash" ? "cash-logo" : a.bank_method === "BancoUnion" ? "union-logo" : ""}`}
                        >
                          {a.type === "cash" ? (
                            <Icon name="Banknote" size={22} />
                          ) : a.bank_method === "BancoDeBolivia" ? (
                            "BNB"
                          ) : a.bank_method === "BancoUnion" ? (
                            "U"
                          ) : (
                            a.name.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <div>
                          <span>{a.name}</span>
                          <strong>{hidden ? "••••" : money(b[a.id])}</strong>
                        </div>
                        <Icon name="ChevronRight" size={15} />
                      </button>
                    ))}
                </div>
                {!state.accounts.length && (
                  <Empty
                    title="Tu primera cuenta"
                    description="Añade un banco o efectivo para empezar."
                    icon="Wallet"
                  >
                    <Button icon="Plus" onClick={() => entity("account")}>
                      Añadir cuenta
                    </Button>
                  </Empty>
                )}
              </section>
              <div className="dashboard-bottom">
                <section className="panel movements-panel">
                  <SectionHead title="Últimos movimientos">
                    <button
                      className="text-button"
                      onClick={() => changePage("movements")}
                    >
                      Ver todos
                      <Icon name="ArrowRight" size={15} />
                    </button>
                  </SectionHead>
                  {recent.length ? (
                    recent.map((m) => (
                      <MovementRow
                        key={m.id}
                        m={m}
                        state={state}
                        onClick={() => edit(m)}
                        pending={pendingIds.has(m.id)}
                      />
                    ))
                  ) : (
                    <Empty
                      title="Cada historia empieza con un movimiento"
                      description="Registra tu primer gasto o ingreso."
                      icon="ArrowLeftRight"
                    />
                  )}
                </section>
                <section className="panel spending-panel">
                  <SectionHead title="¿En qué estás gastando?">
                    <span className="tiny-label">ESTE MES</span>
                  </SectionHead>
                  {D(summary.expense).gt(0) ? (
                    <Donut
                      items={summary.expensesByCategory}
                      total={summary.expense}
                      onSelect={(id) => showFiltered("", id)}
                    />
                  ) : (
                    <Empty
                      title="Todavía no hay gastos"
                      description="Verás tus categorías a medida que registres movimientos."
                    />
                  )}
                </section>
              </div>
              <div className="dashboard-bottom bottom-row">
                <section className="panel">
                  <SectionHead title="Un plan para tu mes">
                    <button
                      className="text-button"
                      onClick={() => entity("budget")}
                    >
                      Añadir
                      <Icon name="Plus" size={15} />
                    </button>
                  </SectionHead>
                  <BudgetList
                    state={state}
                    month={month}
                    onEdit={(v) => entity("budget", v)}
                  />
                </section>
                <section className="panel">
                  <SectionHead title="Lo que viene">
                    <Icon name="CalendarDays" size={18} />
                  </SectionHead>
                  <RecurringList
                    state={state}
                    onEdit={(r) => entity("recurring", r)}
                    onPay={(r) => void confirmRecurring(r)}
                  />
                </section>
              </div>
            </div>
          )}
          {page === "movements" && (
            <MovementsScreen
              state={state}
              month={month}
              initialAccount={filterAccount}
              initialPeriod={filterPeriod}
              initialCategory={filterCategory}
              onEdit={edit}
              pendingIds={pendingIds}
              onRegister={() => register()}
            />
          )}
          {page === "accounts" && (
            <div className="page-enter">
              <SectionHead
                title={`${state.accounts.filter((a) => !a.archived).length} cuentas activas`}
              >
                <Button icon="Plus" onClick={() => entity("account")}>
                  Añadir cuenta
                </Button>
              </SectionHead>
              <div className="account-cards">
                {state.accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <section className="bank-card" key={a.id}>
                      <div className="bank-card-top">
                        <span
                          className={`bank-logo ${a.type === "cash" ? "cash-logo" : ""}`}
                        >
                          {a.type === "cash" ? (
                            <Icon name="Banknote" />
                          ) : a.bank_method === "BancoDeBolivia" ? (
                            "BNB"
                          ) : a.bank_method === "BancoUnion" ? (
                            "U"
                          ) : (
                            a.name.slice(0, 2).toUpperCase()
                          )}
                        </span>
                        <button
                          className="icon-btn"
                          aria-label={`Editar ${a.name}`}
                          onClick={() => entity("account", a)}
                        >
                          <Icon name="MoreHorizontal" />
                        </button>
                      </div>
                      <p>{a.name}</p>
                      <strong className="bank-balance">{money(b[a.id])}</strong>
                      <span className="bank-type">
                        {a.type === "cash"
                          ? "EFECTIVO"
                          : "CUENTA EN BOLIVIANOS"}
                      </span>
                      <div className="bank-card-actions">
                        <button onClick={() => showFiltered(a.id)}>
                          Movimientos
                          <Icon name="ArrowRight" size={16} />
                        </button>
                        <button
                          onClick={() =>
                            setModal({ type: "reconcile", account: a })
                          }
                        >
                          Conciliar
                          <Icon name="CheckCircle2" size={16} />
                        </button>
                      </div>
                    </section>
                  ))}
              </div>
              <div className="accounts-footer">
                <span>
                  <Icon name="ShieldCheck" size={18} />
                  Saldos derivados de tus movimientos. Cada ajuste conserva su
                  historial.
                </span>
                <Button
                  icon="ArrowLeftRight"
                  onClick={() => register("transfer")}
                >
                  Transferir entre cuentas
                </Button>
              </div>
              {state.accounts.some((a) => a.archived) && (
                <details className="archived-list">
                  <summary>Cuentas archivadas</summary>
                  {state.accounts
                    .filter((a) => a.archived)
                    .map((a) => (
                      <button key={a.id} onClick={() => entity("account", a)}>
                        {a.name}
                        <Icon name="ChevronRight" size={16} />
                      </button>
                    ))}
                </details>
              )}
            </div>
          )}
          {page === "binance" && (
            <div className="page-enter">
              <div className="binance-overview">
                <section className="wealth-card binance-hero">
                  <div className="wealth-top">
                    <span>
                      <BinanceMark size={20} />
                      TU SALDO EN BINANCE
                    </span>
                    <span className="pill">USDT</span>
                  </div>
                  <div className="wealth-value">
                    {units(wallet.quantity)}
                    <span>USDT</span>
                  </div>
                  <p>
                    {valuation
                      ? `≈ ${money(valuation)} a la última referencia`
                      : "Añade una referencia para estimar su valor en BOB"}
                  </p>
                  <div className="wealth-breakdown">
                    <div>
                      <span>Disponible</span>
                      <strong>{units(available)} USDT</strong>
                    </div>
                    <div>
                      <span>Reservado en metas</span>
                      <strong>{units(saved)} USDT</strong>
                    </div>
                  </div>
                  <div className="wealth-decoration" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                </section>
                <section className="quote-card">
                  <div className="quote-heading">
                    <span>Referencia de venta P2P</span>
                    <button
                      className="icon-btn"
                      aria-label="Actualizar cotización"
                      onClick={() => void refreshQuote()}
                      disabled={quoteBusy}
                    >
                      <Icon
                        name="RefreshCw"
                        size={17}
                        className={quoteBusy ? "spin" : ""}
                      />
                    </button>
                  </div>
                  <strong>
                    {quote ? money(quote.price) : "Sin referencia"}
                    <small>/ USDT</small>
                  </strong>
                  <p>
                    <span
                      className={`status-dot ${quoteStale(quote) ? "amber" : ""}`}
                    />
                    {quote?.source === "manual"
                      ? "Referencia manual"
                      : quote
                        ? "Mediana de anuncios filtrados"
                        : "Pendiente de cotización"}
                    {quote &&
                      ` · ${new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", hour: "2-digit", minute: "2-digit" }).format(new Date(quote.observed_at))}`}
                  </p>
                  {quoteStale(quote) && quote && (
                    <span className="pill amber-text">
                      Desactualizada · {displayDate(quote.observed_at)}
                    </span>
                  )}
                  <Sparkline
                    observations={state.quotes.filter(
                      (q) => q.source === "binance",
                    )}
                  />
                  <small>
                    Solo referencias guardadas. Las interrupciones de más de 15
                    minutos quedan sin línea.
                  </small>
                  <div className="quote-actions">
                    <button onClick={() => entity("profile", state.profile)}>
                      Filtros
                      <Icon name="SlidersHorizontal" size={15} />
                    </button>
                    <button onClick={() => entity("quote")}>
                      Referencia manual
                      <Icon name="Pencil" size={15} />
                    </button>
                  </div>
                </section>
              </div>
              {quoteError && (
                <div className="info-banner">
                  <Icon name="AlertCircle" size={18} />
                  <span>{quoteError}</span>
                </div>
              )}
              <div className="binance-metrics">
                <Metric
                  label="Costo de tus USDT restantes"
                  value={money(wallet.known_cost)}
                  note={
                    D(wallet.unknown_quantity).gt(0)
                      ? `${units(wallet.unknown_quantity)} USDT sin costo · parcial`
                      : "Costo de adquisición · FIFO"
                  }
                />
                <Metric
                  label="Ganancia estimada sin vender"
                  value={unrealized ? money(unrealized) : "Sin referencia"}
                  positive={Boolean(unrealized?.gte(0))}
                  note={
                    D(wallet.unknown_quantity).gt(0)
                      ? "Solo USDT con costo conocido"
                      : quoteStale(quote)
                        ? "Con la última referencia · desactualizada"
                        : "Según referencia de venta P2P"
                  }
                />
                <Metric
                  label="Ganancia de ventas realizadas"
                  value={money(
                    wallet.sales.reduce((s, x) => s.plus(x.profit ?? 0), D(0)),
                  )}
                  positive
                  note={
                    wallet.sales.some((x) => x.profit === null)
                      ? "Parcial · hay ventas con costo incompleto"
                      : "Bolivianos recibidos menos costo FIFO"
                  }
                />
              </div>
              <BinanceTabs
                state={state}
                wallet={wallet}
                quote={quote}
                onEdit={edit}
                onBuy={() => register("buy")}
                onSell={() => register("sell")}
                onGoal={(g) => entity("goal", g)}
              />
              <p className="valuation-note">
                <Icon name="AlertCircle" size={16} />
                La referencia corresponde a{" "}
                {quote?.quantity ?? state.profile.quote_settings.quantity} USDT.
                El precio y los límites pueden variar al vender. Tus metas
                forman parte del saldo total.
              </p>
            </div>
          )}
          {page === "reports" && (
            <ReportsScreen
              state={state}
              month={month}
              onCategory={(id, period, account) =>
                showFiltered(account, id, period)
              }
              onAccount={(id, period) => showFiltered(id, "", period)}
              onBudget={(v) => entity("budget", v)}
            />
          )}
          <footer className="page-footer">
            <span>Un movimiento a la vez.</span>
            <span>
              BOB · USDT<span className="dot">·</span>America/La_Paz
            </span>
          </footer>
        </main>
      </div>
      <button
        className="register-fab"
        aria-label="Registrar movimiento"
        onClick={() => register()}
      >
        <Icon name="Plus" size={26} />
      </button>
      <nav className="mobile-nav" aria-label="Navegación móvil">
        {nav.map((n) => (
          <button
            key={n.id}
            className={page === n.id ? "active" : ""}
            onClick={() => changePage(n.id)}
            aria-current={page === n.id ? "page" : undefined}
          >
            {n.id === "binance" ? (
              <BinanceMark size={21} />
            ) : (
              <Icon name={n.icon} size={21} />
            )}
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      {ctx.message && (
        <div className="toast" role="status">
          <Icon name="CheckCircle2" size={19} />
          <span>{ctx.message}</span>
          {ctx.undoAction && (
            <button
              className="toast-undo"
              onClick={() => ctx.undoAction?.().catch((e) => notify(e.message))}
            >
              Deshacer
            </button>
          )}
          <button
            aria-label="Cerrar mensaje"
            className="icon-btn"
            onClick={() => notify("")}
          >
            <Icon name="X" size={16} />
          </button>
        </div>
      )}
      {modal && (
        <Modal
          title={
            modal.type === "movement"
              ? modal.initial &&
                state.movements.some((m) => m.id === modal.initial!.id)
                ? "Detalle del movimiento"
                : "Un nuevo movimiento"
              : modal.type === "entity"
                ? entityTitles[modal.entity]
                : modal.type === "onboarding"
                  ? "Tu punto de partida"
                  : modal.type === "reconcile"
                    ? "Todo vuelve a cuadrar"
                    : modal.type === "sync"
                      ? "Guardado y sincronización"
                      : "A tu manera."
          }
          subtitle={
            modal.type === "settings"
              ? "Organiza tu espacio para que funcione contigo."
              : modal.type === "movement"
                ? "Los pequeños registros hacen la diferencia."
                : undefined
          }
          onClose={() => setModal(null)}
          wide={modal.type === "settings" || modal.type === "onboarding"}
        >
          {modal.type === "movement" && (
            <MovementForm
              initial={modal.initial}
              onClose={() => setModal(null)}
            />
          )}{" "}
          {modal.type === "entity" && (
            <EntityForm
              entity={modal.entity}
              initial={modal.initial}
              onClose={() => setModal(null)}
            />
          )}{" "}
          {modal.type === "onboarding" && (
            <Onboarding onClose={() => setModal(null)} />
          )}{" "}
          {modal.type === "reconcile" && (
            <ReconcileForm
              account={modal.account}
              onClose={() => setModal(null)}
            />
          )}{" "}
          {modal.type === "settings" && (
            <div>
              <div className="segmented settings-tabs">
                {[
                  ["categories", "Categorías"],
                  ["budgets", "Presupuestos"],
                  ["recurring", "Recurrentes"],
                  ["preferences", "Mi espacio"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={settingsTab === id ? "active" : ""}
                    onClick={() => setSettingsTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {settingsTab === "categories" && (
                <>
                  <div className="settings-heading">
                    <p className="quiet">
                      Tus categorías de gastos e ingresos.
                    </p>
                    <Button icon="Plus" onClick={() => entity("category")}>
                      Nueva
                    </Button>
                  </div>
                  {[...state.categories]
                    .sort((a, b) => a.position - b.position)
                    .map((c) => (
                      <button
                        className="setting-row"
                        key={c.id}
                        onClick={() => entity("category", c)}
                      >
                        <span
                          className="category-icon"
                          style={{ color: c.color }}
                        >
                          <Icon name={c.icon} />
                        </span>
                        <div>
                          <strong>{c.name}</strong>
                          <small>
                            {c.archived
                              ? "Archivada"
                              : c.type === "expense"
                                ? "Gasto"
                                : "Ingreso"}
                            {c.favorite ? " · Favorita" : ""}
                          </small>
                        </div>
                        <Icon name="Pencil" size={16} />
                      </button>
                    ))}
                </>
              )}
              {settingsTab === "budgets" && (
                <>
                  <div className="settings-heading">
                    <p className="quiet">Límites por categoría y mes.</p>
                    <Button icon="Plus" onClick={() => entity("budget")}>
                      Nuevo
                    </Button>
                  </div>
                  <BudgetList
                    state={state}
                    month={month}
                    onEdit={(v) => entity("budget", v)}
                  />
                </>
              )}
              {settingsTab === "recurring" && (
                <>
                  <div className="settings-heading">
                    <p className="quiet">
                      Se registran cuando confirmas el pago.
                    </p>
                    <Button icon="Plus" onClick={() => entity("recurring")}>
                      Nuevo
                    </Button>
                  </div>
                  <RecurringList
                    state={state}
                    onEdit={(r) => entity("recurring", r)}
                    onPay={(r) => void confirmRecurring(r)}
                  />
                </>
              )}
              {settingsTab === "preferences" && (
                <div className="form-stack preferences-list">
                  <Button
                    icon="Settings2"
                    onClick={() => entity("profile", state.profile)}
                  >
                    Nombre y referencia P2P
                  </Button>
                  <Button
                    icon="Cloud"
                    onClick={() => setModal({ type: "sync" })}
                  >
                    Estado de sincronización
                  </Button>
                  <Button
                    icon="Shapes"
                    onClick={async () => {
                      await ctx.switchMode(mode === "demo" ? "local" : "demo");
                      setModal(null);
                    }}
                  >
                    {" "}
                    {mode === "demo"
                      ? "Ir a mi espacio local"
                      : "Explorar la demostración"}
                  </Button>
                  {cloudConfigured() && (
                    <Button
                      icon="Cloud"
                      onClick={async () => {
                        await ctx.switchMode("cloud");
                        setModal(null);
                      }}
                    >
                      Ir a mi espacio en la nube
                    </Button>
                  )}
                  {mode === "cloud" && (
                    <Button
                      icon="LogOut"
                      disabled={sessionBusy}
                      onClick={() => void leaveWorkspace()}
                    >
                      Cerrar sesión
                    </Button>
                  )}
                  <p className="quiet">
                    {mode === "cloud"
                      ? "Tu información se guarda en tu cuenta privada."
                      : "Este espacio se guarda únicamente en el navegador de este dispositivo. La demostración está separada de tus datos."}
                  </p>
                </div>
              )}
            </div>
          )}
          {modal.type === "sync" && (
            <div className="form-stack">
              <div className="sync-state">
                <Icon
                  name={
                    !online
                      ? "WifiOff"
                      : mode === "cloud"
                        ? "Cloud"
                        : "CloudOff"
                  }
                  size={36}
                />
                <h3>
                  {mode === "cloud"
                    ? online
                      ? "Tu espacio en la nube"
                      : "Tus registros están seguros en este dispositivo"
                    : mode === "demo"
                      ? "Espacio de demostración"
                      : "Guardado en este dispositivo"}
                </h3>
                <p>
                  {mode === "cloud"
                    ? "Los pendientes se envían al recuperar la conexión."
                    : "La conexión con Supabase aún no está activa en este espacio. Los cambios se conservan en este navegador."}
                </p>
              </div>
              {pending.map((p) => (
                <div
                  className="pending-card"
                  key={`${p.command.id}-${p.command.type}`}
                >
                  <span className="pill">
                    {p.status === "failed" ? "Necesita revisión" : "Pendiente"}
                  </span>
                  <strong>
                    {String(
                      p.command.payload.note ??
                        p.command.payload.name ??
                        "Movimiento",
                    )}
                  </strong>
                  {p.error && <p className="danger">{p.error}</p>}
                  {p.status === "failed" && p.command.type === "movement" && (
                    <Button
                      onClick={() =>
                        setModal({
                          type: "movement",
                          initial: p.command.payload as unknown as Movement,
                        })
                      }
                    >
                      Revisar datos
                    </Button>
                  )}
                  {p.status === "failed" && (
                    <button
                      className="text-button danger"
                      onClick={() =>
                        ctx
                          .discardPending(p.command.id)
                          .catch((e) => notify(e.message))
                      }
                    >
                      Descartar registro rechazado
                    </button>
                  )}
                </div>
              ))}
              {mode === "cloud" && (
                <Button
                  className="primary full"
                  icon="RefreshCw"
                  onClick={() => void ctx.sync()}
                >
                  Sincronizar ahora
                </Button>
              )}
              <p className="quiet">
                Los registros rechazados conservan sus datos para que puedas
                corregirlos.
              </p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  positive = false,
}: {
  label: string;
  value: string;
  note: string;
  positive?: boolean;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
function BudgetList({
  state,
  month,
  onEdit,
}: {
  state: FinanceState;
  month: string;
  onEdit: (b: Budget) => void;
}) {
  const range = monthRange(month),
    summary = report(state, range.from, range.to),
    items = state.budgets.filter((b) => b.month === month);
  if (!items.length)
    return (
      <Empty
        title="Dale un límite a tus categorías"
        description="Crea tu primer presupuesto mensual."
        icon="Target"
      />
    );
  return (
    <div className="budget-list">
      {items.map((b) => {
        const cat = state.categories.find((c) => c.id === b.category_id),
          spent =
            summary.expensesByCategory.find((c) => c.id === b.category_id)
              ?.amount ?? "0",
          percent = D(spent).div(b.amount).mul(100);
        return (
          <button className="budget-item" key={b.id} onClick={() => onEdit(b)}>
            <div>
              <span className="legend-dot" style={{ background: cat?.color }} />
              <strong>{cat?.name.split(" — ")[0]}</strong>
              <span>
                {money(spent)} <small>/ {money(b.amount)}</small>
              </span>
            </div>
            <div className="progress-track">
              <i
                style={{
                  width: `${Math.min(100, percent.toNumber())}%`,
                  background: percent.gte(100)
                    ? "#F29B9B"
                    : percent.gte(80)
                      ? "#E6C478"
                      : cat?.color,
                }}
              />
            </div>
            <small
              className={
                percent.gte(100)
                  ? "danger"
                  : percent.gte(80)
                    ? "amber-text"
                    : ""
              }
            >
              {percent.toFixed(0)} % utilizado
              <span>
                {percent.gte(100)
                  ? "Límite alcanzado"
                  : percent.gte(80)
                    ? "Cerca de tu límite"
                    : `${money(D(b.amount).minus(spent))} disponibles`}
              </span>
            </small>
          </button>
        );
      })}
    </div>
  );
}
function RecurringList({
  state,
  onEdit,
  onPay,
}: {
  state: FinanceState;
  onEdit: (r: Recurring) => void;
  onPay: (r: Recurring) => void;
}) {
  const items = state.recurring
    .filter((r) => !r.archived)
    .sort((a, b) => a.next_date.localeCompare(b.next_date));
  if (!items.length)
    return (
      <Empty
        title="Anticípate a tus próximos pagos"
        description="Añade gym, servicios o cualquier pago recurrente."
        icon="CalendarDays"
      />
    );
  return (
    <div className="recurring-list">
      {items.map((r) => (
        <div className="recurring-row" key={r.id}>
          <button className="recurring-info" onClick={() => onEdit(r)}>
            <span className="category-icon">
              <Icon
                name={
                  state.categories.find((c) => c.id === r.category_id)?.icon ??
                  "CalendarDays"
                }
              />
            </span>
            <span>
              <strong>{r.name}</strong>
              <small>
                {r.next_date <= today()
                  ? "Por confirmar"
                  : displayDate(atDay(r.next_date))}{" "}
                · {money(r.amount)}
              </small>
            </span>
          </button>
          <button
            className="pay-button"
            disabled={r.next_date > today()}
            onClick={() => onPay(r)}
            aria-label={`Confirmar pago ${r.name}`}
          >
            <Icon name={r.next_date <= today() ? "Check" : "Clock"} size={17} />
            <span>{r.next_date <= today() ? "Pagué" : "Próximo"}</span>
          </button>
        </div>
      ))}
    </div>
  );
}
function downloadCSV(
  state: FinanceState,
  movements: Movement[],
  name = "movimientos",
) {
  const blob = new Blob([csv(state, movements)], {
      type: "text/csv;charset=utf-8",
    }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = `saldo-${name}-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
function MovementsScreen({
  state,
  month,
  initialAccount,
  initialCategory,
  initialPeriod,
  onEdit,
  pendingIds,
  onRegister,
}: {
  state: FinanceState;
  month: string;
  initialAccount: string;
  initialCategory: string;
  initialPeriod: { from: string; to: string } | null;
  onEdit: (m: Movement) => void;
  pendingIds: Set<string>;
  onRegister: () => void;
}) {
  const [search, setSearch] = useState(""),
    [kind, setKind] = useState(""),
    [account, setAccount] = useState(initialAccount),
    [category, setCategory] = useState(initialCategory),
    [filters, setFilters] = useState(false),
    [from, setFrom] = useState(initialPeriod?.from ?? monthRange(month).from),
    [to, setTo] = useState(initialPeriod?.to ?? monthRange(month).to);
  useEffect(() => {
    setFrom(initialPeriod?.from ?? monthRange(month).from);
    setTo(initialPeriod?.to ?? monthRange(month).to);
  }, [month, initialPeriod]);
  useEffect(() => setAccount(initialAccount), [initialAccount]);
  useEffect(() => setCategory(initialCategory), [initialCategory]);
  const result = state.movements
    .filter(
      (m) =>
        !m.voided &&
        !m.history_only &&
        localDay(m.occurred_at) >= from &&
        localDay(m.occurred_at) <= to &&
        (!kind || m.kind === kind) &&
        (!account ||
          m.account_id === account ||
          m.destination_id === account) &&
        (!category || m.category_id === category) &&
        `${m.note} ${state.categories.find((c) => c.id === m.category_id)?.name ?? ""} ${state.accounts.find((a) => a.id === m.account_id)?.name ?? ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  return (
    <div className="page-enter">
      <div className="filter-toolbar">
        <div className="search-input">
          <Icon name="Search" size={18} />
          <input
            placeholder="Buscar un movimiento…"
            aria-label="Buscar movimientos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Tipo de movimiento"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Todos los tipos</option>
          {["expense", "income", "transfer", "buy", "sell", "adjustment"].map(
            (k) => (
              <option key={k} value={k}>
                {kindNames[k]}
              </option>
            ),
          )}
        </select>
        <Button icon="SlidersHorizontal" onClick={() => setFilters(!filters)}>
          Filtros
        </Button>
        <Button
          icon="Download"
          className="export-btn"
          onClick={() =>
            downloadCSV(
              state,
              result.filter((m) => !pendingIds.has(m.id)),
            )
          }
        >
          Exportar
        </Button>
      </div>
      {(filters || account || category) && (
        <div className="expanded-filters">
          <label>
            <span>Cuenta</span>
            <select
              aria-label="Filtrar por cuenta"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              <option value="">Todas</option>
              {state.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Categoría</span>
            <select
              aria-label="Filtrar por categoría"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">Todas</option>
              {state.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Desde</span>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Desde"
            />
          </label>
          <label>
            <span>Hasta</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Hasta"
            />
          </label>
          <button
            className="text-button"
            onClick={() => {
              setAccount("");
              setCategory("");
              setSearch("");
              setKind("");
              setFrom(monthRange(month).from);
              setTo(monthRange(month).to);
            }}
          >
            Limpiar
          </button>
        </div>
      )}
      <section className="panel all-movements">
        <div className="list-caption">
          <span>{result.length} movimientos</span>
          <span>Los movimientos de fondos conservan su propio tipo.</span>
        </div>
        {result.length ? (
          result.map((m) => (
            <MovementRow
              key={m.id}
              m={m}
              state={state}
              onClick={() => onEdit(m)}
              pending={pendingIds.has(m.id)}
            />
          ))
        ) : (
          <Empty
            title="Nada por aquí, por ahora"
            description="Prueba otro período o registra tu primer movimiento."
            icon="Search"
          >
            <Button icon="Plus" className="primary" onClick={onRegister}>
              Registrar movimiento
            </Button>
          </Empty>
        )}
      </section>
    </div>
  );
}
function BinanceTabs({
  state,
  wallet,
  quote,
  onEdit,
  onBuy,
  onSell,
  onGoal,
}: {
  state: FinanceState;
  wallet: ReturnType<typeof inventory>;
  quote: Quote | undefined;
  onEdit: (m: Movement) => void;
  onBuy: () => void;
  onSell: () => void;
  onGoal: (g?: Goal) => void;
}) {
  const [tab, setTab] = useState("buy"),
    items = state.movements
      .filter(
        (m) =>
          !m.voided &&
          (tab === "buy"
            ? ["buy", "opening"].includes(m.kind)
            : m.kind === "sell"),
      )
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  return (
    <section className="panel binance-detail">
      <div className="binance-tabs">
        <div className="underline-tabs">
          {[
            ["buy", "Ingresos"],
            ["sell", "Egresos"],
            ["goals", "Ahorro"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
              <span>
                {id === "goals"
                  ? state.goals.filter((g) => !g.archived).length
                  : state.movements.filter(
                      (m) =>
                        !m.voided &&
                        (id === "buy"
                          ? ["buy", "opening"].includes(m.kind)
                          : m.kind === "sell"),
                    ).length}
              </span>
            </button>
          ))}
        </div>
        <Button
          icon="Plus"
          className="primary"
          onClick={() =>
            tab === "goals" ? onGoal() : tab === "buy" ? onBuy() : onSell()
          }
        >
          {tab === "goals"
            ? "Nueva meta"
            : tab === "buy"
              ? "Registrar compra"
              : "Registrar venta"}
        </Button>
      </div>
      {tab === "goals" ? (
        <div className="goal-grid">
          {state.goals
            .filter((g) => !g.archived)
            .map((g, i) => {
              const value =
                  g.target_currency === "USDT"
                    ? D(g.reserved_usdt)
                    : quote
                      ? D(g.reserved_usdt).mul(quote.price)
                      : null,
                percent = value ? value.div(g.target_amount).mul(100) : null;
              return (
                <button
                  className="goal-card"
                  key={g.id}
                  onClick={() => onGoal(g)}
                >
                  <div className="goal-top">
                    <span className="goal-icon">
                      <Icon
                        name={i === 0 ? "ShieldCheck" : "Plane"}
                        size={25}
                      />
                    </span>
                    <Icon name="ArrowUpRight" size={18} />
                  </div>
                  <h3>{g.name}</h3>
                  <p>{units(g.reserved_usdt)} USDT reservados</p>
                  <div className="goal-value">
                    <strong>
                      {g.target_currency === "USDT"
                        ? `${units(value ?? 0)} USDT`
                        : value
                          ? money(value)
                          : "Sin referencia"}
                    </strong>
                    <span>
                      de{" "}
                      {g.target_currency === "USDT"
                        ? `${units(g.target_amount)} USDT`
                        : money(g.target_amount)}
                    </span>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${Math.min(100, percent?.toNumber() ?? 0)}%`,
                        background: "#83D6AF",
                      }}
                    />
                  </div>
                  <div className="goal-bottom">
                    <span>
                      {percent
                        ? `${percent.toFixed(0)} % de tu objetivo`
                        : "Pendiente de valorar"}
                    </span>
                    <span>
                      {g.due_date
                        ? displayDate(atDay(g.due_date))
                        : "A tu ritmo"}
                    </span>
                  </div>
                </button>
              );
            })}
          {!state.goals.some((g) => !g.archived) && (
            <Empty
              title="Ponle nombre a tu ahorro"
              description="Crea una meta y reserva USDT para lo que viene."
              icon="Target"
            />
          )}
        </div>
      ) : (
        <>
          <p className="table-description">
            {tab === "buy"
              ? "Cada compra conserva su costo y cantidad restante. El historial inicial no vuelve a descontar dinero de tus bancos."
              : "Las ventas consumen primero las compras más antiguas. La ganancia se calcula con los bolivianos realmente recibidos."}
          </p>
          <div className="crypto-table-header">
            <span>{tab === "buy" ? "Compra" : "Venta"}</span>
            <span>USDT</span>
            <span>{tab === "buy" ? "Costo efectivo" : "Resultado FIFO"}</span>
            <span>{tab === "buy" ? "Restantes" : "BOB recibidos"}</span>
          </div>
          {items.map((m) => {
            const lot = wallet.lots.find((l) => l.id === m.id),
              sale = wallet.sales.find((s) => s.id === m.id);
            return (
              <button
                key={m.id}
                className="crypto-row"
                onClick={() => onEdit(m)}
              >
                <span>
                  <strong>{m.note || kindNames[m.kind]}</strong>
                  <small>
                    {displayDate(m.occurred_at)}
                    {m.history_only ? " · Historial inicial" : ""}
                  </small>
                </span>
                <strong>
                  {units(m.usdt_quantity)}
                  <small>USDT</small>
                </strong>
                <span>
                  <strong
                    className={
                      tab === "sell" && sale?.profit && D(sale.profit).gte(0)
                        ? "positive"
                        : ""
                    }
                  >
                    {tab === "buy"
                      ? lot?.unit_cost
                        ? money(lot.unit_cost)
                        : "Costo incompleto"
                      : sale?.profit !== null && sale?.profit !== undefined
                        ? money(sale.profit)
                        : "Costo incompleto"}
                  </strong>
                  <small>
                    {tab === "buy" ? "BOB / USDT" : "Ganancia realizada"}
                  </small>
                </span>
                <span>
                  <strong>
                    {tab === "buy"
                      ? `${units(lot?.remaining ?? 0)} USDT`
                      : money(D(m.amount_bob).minus(m.fee_bob))}
                  </strong>
                  <Icon name="ChevronRight" size={15} />
                </span>
              </button>
            );
          })}
          {!items.length && (
            <Empty
              title={
                tab === "buy"
                  ? "Tus compras empiezan aquí"
                  : "Todavía no has registrado ventas"
              }
              description="Registra una operación para conservar su costo y resultado."
              icon="Coins"
            />
          )}
        </>
      )}
    </section>
  );
}
function ReportsScreen({
  state,
  month,
  onCategory,
  onAccount,
  onBudget,
}: {
  state: FinanceState;
  month: string;
  onCategory: (
    id: string,
    period: { from: string; to: string },
    account: string,
  ) => void;
  onAccount: (id: string, period: { from: string; to: string }) => void;
  onBudget: (b: Budget) => void;
}) {
  const [from, setFrom] = useState(monthRange(month).from),
    [to, setTo] = useState(monthRange(month).to),
    [account, setAccount] = useState("");
  useEffect(() => {
    setFrom(monthRange(month).from);
    setTo(monthRange(month).to);
  }, [month]);
  const summary = report(state, from, to, account),
    prevRange = monthRange(previousMonth(month)),
    previous = report(state, prevRange.from, prevRange.to, account),
    change = D(previous.expense).gt(0)
      ? D(summary.expense)
          .minus(previous.expense)
          .div(previous.expense)
          .mul(100)
      : null;
  const monthly = [];
  const holdings = inventory(state.movements),
    valuationQuote = latestQuote(state),
    valuation = valuationQuote
      ? D(holdings.quantity).mul(valuationQuote.price)
      : null,
    unrealized =
      valuation && D(holdings.unknown_quantity).isZero()
        ? valuation.minus(holdings.known_cost)
        : null;
  let m = month;
  for (let i = 0; i < 6; i++) {
    const r = monthRange(m),
      s = report(state, r.from, r.to, account);
    monthly.unshift({ month: m, income: s.income, expense: s.expense });
    m = previousMonth(m);
  }
  return (
    <div className="page-enter">
      <div className="report-filters">
        <label>
          <span>Desde</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Reporte desde"
          />
        </label>
        <label>
          <span>Hasta</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Reporte hasta"
          />
        </label>
        <label>
          <span>Cuenta</span>
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            aria-label="Cuenta del reporte"
          >
            <option value="">Todas las cuentas</option>
            {state.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          icon="Download"
          onClick={() => downloadCSV(state, summary.movements, "reporte")}
        >
          Exportar CSV
        </Button>
      </div>
      {from > to ? (
        <div className="info-banner">
          La fecha final debe ser posterior a la inicial.
        </div>
      ) : (
        <>
          <div className="report-metrics">
            <Metric
              label="Ingresos del período"
              value={money(summary.income)}
              note="Ingresos personales en BOB"
              positive
            />
            <Metric
              label="Gastos del período"
              value={money(summary.expense)}
              note={
                from === monthRange(month).from &&
                to === monthRange(month).to &&
                change !== null
                  ? `${change.gt(0) ? "+" : ""}${change.toFixed(1)} % vs. mes anterior`
                  : from === monthRange(month).from &&
                      to === monthRange(month).to
                    ? "Sin base de comparación anterior"
                    : "Período personalizado"
              }
            />
            <Metric
              label="Diferencia del período"
              value={money(summary.net)}
              note="Ingresos menos gastos de consumo"
              positive={D(summary.net).gte(0)}
            />
          </div>
          <div className="reports-grid">
            <section className="panel">
              <SectionHead title="La perspectiva de tus meses">
                <div className="chart-key">
                  <span>
                    <i className="legend-dot income-dot" />
                    Ingresos
                  </span>
                  <span>
                    <i className="legend-dot expense-dot" />
                    Gastos
                  </span>
                </div>
              </SectionHead>
              <MonthlyChart items={monthly} />
              <p className="chart-caption">
                Últimos seis meses hasta el mes seleccionado. Los meses vacíos
                se muestran con cero.
              </p>
            </section>
            <section className="panel">
              <SectionHead title="Tus categorías">
                {" "}
                <span className="tiny-label">GASTOS</span>
              </SectionHead>
              {D(summary.expense).gt(0) ? (
                <Donut
                  items={summary.expensesByCategory}
                  total={summary.expense}
                  onSelect={(id) => onCategory(id, { from, to }, account)}
                />
              ) : (
                <Empty
                  title="Sin gastos en este período"
                  description="Selecciona otro rango o registra tus movimientos."
                />
              )}
            </section>
          </div>
          <div className="reports-grid lower">
            <section className="panel">
              <SectionHead title="Dónde usas tu dinero" />
              <div className="account-report">
                {state.accounts.map((a) => {
                  const amount = summary.movements
                    .filter(
                      (m) => m.account_id === a.id && m.kind === "expense",
                    )
                    .reduce((s, m) => s.plus(D(m.amount_bob)), D(0));
                  return (
                    <button
                      key={a.id}
                      onClick={() => onAccount(a.id, { from, to })}
                      aria-label={`Ver movimientos ${a.name}`}
                    >
                      <Icon
                        name={a.type === "cash" ? "Banknote" : "Landmark"}
                        size={18}
                      />
                      <span>{a.name}</span>
                      <strong>{money(amount)}</strong>
                    </button>
                  );
                })}
              </div>
            </section>
            <section className="panel">
              <SectionHead title="Movimientos de fondos" />
              <div className="funds-report">
                <div>
                  <span>Transferencias entre cuentas</span>
                  <strong>
                    {money(
                      summary.movements
                        .filter((m) => m.kind === "transfer")
                        .reduce((sum, m) => sum.plus(D(m.amount_bob)), D(0)),
                    )}
                  </strong>
                </div>
                <div>
                  <span>Compras de USDT</span>
                  <strong>{money(summary.buy)}</strong>
                </div>
                <div>
                  <span>Ventas de USDT</span>
                  <strong>{money(summary.sell)}</strong>
                </div>
                <div>
                  <span>
                    Costo FIFO vendido
                    {summary.incompleteSales ? " · parcial" : ""}
                  </span>
                  <strong>
                    {money(
                      holdings.sales
                        .filter((s) =>
                          summary.movements.some((m) => m.id === s.id),
                        )
                        .reduce((sum, s) => sum.plus(s.cost), D(0)),
                    )}
                  </strong>
                </div>
                <div>
                  <span>
                    Ganancia realizada
                    {summary.incompleteSales ? " · parcial" : ""}
                  </span>
                  <strong
                    className={D(summary.profit).gte(0) ? "positive" : "danger"}
                  >
                    {money(summary.profit)}
                  </strong>
                </div>
                <p>
                  Compras, ventas y transferencias se muestran por separado de
                  tus ingresos y gastos personales.
                </p>
              </div>
            </section>
          </div>
          <section className="panel report-budgets">
            <SectionHead title="Tus presupuestos del mes" />
            <BudgetList state={state} month={month} onEdit={onBudget} />
          </section>
          <div className="reports-grid lower">
            <section className="panel">
              <SectionHead title="Tu Binance hoy" />
              <div className="funds-report">
                <div>
                  <span>Saldo total, incluido ahorro</span>
                  <strong>{units(holdings.quantity)} USDT</strong>
                </div>
                <div>
                  <span>Valoración estimada</span>
                  <strong>
                    {valuation ? money(valuation) : "Sin referencia"}
                  </strong>
                </div>
                <div>
                  <span>
                    Costo conservado
                    {D(holdings.unknown_quantity).gt(0) ? " · parcial" : ""}
                  </span>
                  <strong>{money(holdings.known_cost)}</strong>
                </div>
                <div>
                  <span>Resultado no realizado</span>
                  <strong
                    className={unrealized?.gte(0) ? "positive" : "danger"}
                  >
                    {unrealized
                      ? money(unrealized)
                      : "Costo o referencia incompletos"}
                  </strong>
                </div>
                <p>
                  Valoración del saldo actual, independiente del período
                  seleccionado.{" "}
                  {valuationQuote
                    ? `${valuationQuote.source === "manual" ? "Referencia manual" : "Referencia P2P"} · ${displayDate(valuationQuote.observed_at)}${quoteStale(valuationQuote) ? " · desactualizada" : ""}.`
                    : "Introduce una referencia para calcular el valor."}
                  {D(holdings.unknown_quantity).gt(0)
                    ? ` ${units(holdings.unknown_quantity)} USDT sin costo de adquisición.`
                    : ""}
                </p>
              </div>
            </section>
            <section className="panel">
              <SectionHead title="Tus metas hoy" />
              {state.goals
                .filter((g) => !g.archived)
                .map((g) => {
                  const value =
                    g.target_currency === "USDT"
                      ? D(g.reserved_usdt)
                      : valuationQuote
                        ? D(g.reserved_usdt).mul(valuationQuote.price)
                        : null;
                  const percent = value?.div(g.target_amount).mul(100);
                  return (
                    <div className="report-goal" key={g.id}>
                      <strong>{g.name}</strong>
                      <small>
                        {units(g.reserved_usdt)} USDT reservados ·{" "}
                        {percent
                          ? `${percent.toFixed(0)} % del objetivo`
                          : "Sin valoración"}
                      </small>
                      <div className="progress-track">
                        <i
                          style={{
                            width: `${Math.min(100, percent?.toNumber() ?? 0)}%`,
                            background: "var(--green)",
                          }}
                        />
                      </div>
                      <small>
                        Objetivo:{" "}
                        {g.target_currency === "BOB"
                          ? money(g.target_amount)
                          : `${units(g.target_amount)} USDT`}
                      </small>
                    </div>
                  );
                })}
              {!state.goals.some((g) => !g.archived) && (
                <Empty
                  title="Aún no hay metas"
                  description="Crea una meta desde Ahorro en Binance."
                />
              )}
            </section>
          </div>
          {summary.movements.length === 0 && (
            <p className="form-callout">
              No hay movimientos para el período seleccionado.
            </p>
          )}
        </>
      )}
    </div>
  );
}
