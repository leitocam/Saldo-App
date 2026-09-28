"use client";
import { useEffect, useRef, type ReactNode } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  Wallet,
  Landmark,
  Banknote,
  Dumbbell,
  Utensils,
  ShoppingBasket,
  Gamepad2,
  Zap,
  Car,
  HeartPulse,
  House,
  Shapes,
  BriefcaseBusiness,
  Laptop,
  CircleDollarSign,
  Plane,
  ShieldCheck,
  Target,
  LayoutDashboard,
  ChartNoAxesCombined,
  Settings2,
  Search,
  SlidersHorizontal,
  Download,
  CalendarDays,
  MoreHorizontal,
  RefreshCw,
  WifiOff,
  Cloud,
  CloudOff,
  LogOut,
  Trash2,
  Pencil,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  Coins,
  ArrowLeft,
  LoaderCircle,
  Menu,
  Grip,
} from "lucide-react";
import { money, displayDate, D } from "@/lib/finance";
import type { FinanceState, Movement } from "@/lib/types";
const icons = {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  Wallet,
  Landmark,
  Banknote,
  Dumbbell,
  Utensils,
  ShoppingBasket,
  Gamepad2,
  Zap,
  Car,
  HeartPulse,
  House,
  Shapes,
  BriefcaseBusiness,
  Laptop,
  CircleDollarSign,
  Plane,
  ShieldCheck,
  Target,
  LayoutDashboard,
  ChartNoAxesCombined,
  Settings2,
  Search,
  SlidersHorizontal,
  Download,
  CalendarDays,
  MoreHorizontal,
  RefreshCw,
  WifiOff,
  Cloud,
  CloudOff,
  LogOut,
  Trash2,
  Pencil,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  EyeOff,
  Coins,
  ArrowLeft,
  LoaderCircle,
  Menu,
  Grip,
};
export function Icon({
  name,
  size = 20,
  ...props
}: {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Component = icons[name as keyof typeof icons] ?? Shapes;
  return (
    <Component size={size} strokeWidth={1.7} aria-hidden="true" {...props} />
  );
}
export function BinanceMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      aria-hidden="true"
      fill="currentColor"
    >
      <path d="m16 2 6 6-4 4-2-2-2 2-4-4ZM2 16l6-6 4 4-2 2 2 2-4 4Zm28 0-6 6-4-4 2-2-2-2 4-4ZM16 30l-6-6 4-4 2 2 2-2 4 4ZM16 12l4 4-4 4-4-4Z" />
    </svg>
  );
}
export function Button({
  children,
  icon,
  onClick,
  className = "",
  disabled = false,
  type = "button",
}: {
  children?: ReactNode;
  icon?: string;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      aria-label={typeof children === "string" ? children : undefined}
      className={`btn ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}
export function SectionHead({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
export function Empty({
  icon = "Shapes",
  title,
  description,
  children,
}: {
  icon?: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={26} />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label={title}
      className={`sheet ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <div className="sheet-grip" />
        <div className="sheet-heading">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button aria-label="Cerrar" className="icon-btn" onClick={onClose}>
            <Icon name="X" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="form-error" role="alert">
      <Icon name="AlertCircle" size={18} />
      {error}
    </div>
  ) : null;
}
export const kindNames: Record<string, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  buy: "Compra de USDT",
  sell: "Venta de USDT",
  opening: "Saldo inicial USDT",
  adjustment: "Ajuste de saldo",
};
export function MovementRow({
  m,
  state,
  onClick,
  pending = false,
}: {
  m: Movement;
  state: FinanceState;
  onClick: () => void;
  pending?: boolean;
}) {
  const cat = state.categories.find((c) => c.id === m.category_id),
    account = state.accounts.find((a) => a.id === m.account_id),
    destination = state.accounts.find((a) => a.id === m.destination_id),
    incoming =
      ["income", "sell"].includes(m.kind) ||
      (m.kind === "adjustment" && D(m.amount_bob).gte(0)),
    spend = m.kind === "expense";
  const icon =
    cat?.icon ??
    (m.kind === "transfer"
      ? "ArrowLeftRight"
      : m.kind === "buy" || m.kind === "sell"
        ? "Coins"
        : "Wallet");
  return (
    <button className="movement-row" onClick={onClick}>
      <span
        className="category-icon"
        style={{
          color: cat?.color ?? "#B5B7BC",
          background: `${cat?.color ?? "#B5B7BC"}12`,
        }}
      >
        <Icon name={icon} />
      </span>
      <span className="movement-copy">
        <strong>{m.note || cat?.name || kindNames[m.kind]}</strong>
        <small>
          {account?.name ?? "Historial inicial"}
          {destination ? ` → ${destination.name}` : ""}
          <span className="dot">·</span>
          {displayDate(m.occurred_at)}
          {pending && <span className="pending-label"> · Pendiente</span>}
        </small>
      </span>
      <span
        className={`movement-amount ${incoming ? "positive" : ""} ${spend ? "spend" : ""}`}
      >
        <strong>
          {m.amount_bob === null
            ? "Costo por completar"
            : `${incoming ? "+" : spend || m.kind === "buy" ? "−" : ""}${money(m.amount_bob)}`}
        </strong>
        <small>
          {m.usdt_quantity !== "0"
            ? `${m.usdt_quantity} USDT`
            : (cat?.name ?? kindNames[m.kind])}
        </small>
      </span>
      <Icon name="ChevronRight" size={16} className="row-chevron" />
    </button>
  );
}
