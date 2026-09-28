"use client";
import { D, money } from "@/lib/finance";
export function Donut({
  items,
  total,
  onSelect,
}: {
  items: { id: string; name: string; amount: string; color: string }[];
  total: string;
  onSelect?: (id: string) => void;
}) {
  let offset = 0;
  const circumference = 2 * Math.PI * 70;
  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg
          viewBox="0 0 180 180"
          role="img"
          aria-label={`Gastos por categoría: ${money(total)}`}
        >
          <circle
            cx="90"
            cy="90"
            r="70"
            fill="none"
            stroke="#25272B"
            strokeWidth="15"
          />
          {items.map((item) => {
            const length = D(total).gt(0)
              ? D(item.amount).div(total).toNumber() * circumference
              : 0;
            const current = offset;
            offset += length;
            return (
              <circle
                key={item.id}
                cx="90"
                cy="90"
                r="70"
                fill="none"
                stroke={item.color}
                strokeWidth="15"
                strokeDasharray={`${Math.max(0, length - 4)} ${circumference}`}
                strokeDashoffset={-current}
                transform="rotate(-90 90 90)"
              >
                <title>
                  {item.name}: {money(item.amount)}
                </title>
              </circle>
            );
          })}
        </svg>
        <div className="donut-label">
          <small>Total de gastos</small>
          <strong>{money(total)}</strong>
        </div>
      </div>
      <div className="chart-legend">
        {items.slice(0, 5).map((item) => (
          <button key={item.id} onClick={() => onSelect?.(item.id)}>
            <span className="legend-dot" style={{ background: item.color }} />
            <span>{item.name.split(" — ")[0]}</span>
            <strong>
              {D(total).gt(0)
                ? D(item.amount).div(total).mul(100).toFixed(0)
                : 0}
              %
            </strong>
          </button>
        ))}
      </div>
    </div>
  );
}
export function MonthlyChart({
  items,
}: {
  items: { month: string; income: string; expense: string }[];
}) {
  const max = Math.max(
    1,
    ...items.flatMap((i) => [D(i.income).toNumber(), D(i.expense).toNumber()]),
  );
  return (
    <div
      className="monthly-chart"
      role="img"
      aria-label="Comparación mensual de ingresos y gastos"
    >
      <div className="chart-y-labels">
        <span>{money(max)}</span>
        <span>{money(max / 2)}</span>
        <span>Bs 0</span>
      </div>
      <div className="bar-plot">
        <div className="chart-gridline top" />
        <div className="chart-gridline mid" />
        <div className="chart-gridline bottom" />
        {items.map((i) => (
          <div className="bar-group" key={i.month}>
            <div className="bars">
              <div
                className="bar income"
                style={{ height: `${D(i.income).div(max).mul(100)}%` }}
                tabIndex={0}
                aria-label={`${i.month}: ingresos ${money(i.income)}`}
              >
                <span className="bar-tooltip">{money(i.income)}</span>
              </div>
              <div
                className="bar expense"
                style={{ height: `${D(i.expense).div(max).mul(100)}%` }}
                tabIndex={0}
                aria-label={`${i.month}: gastos ${money(i.expense)}`}
              >
                <span className="bar-tooltip">{money(i.expense)}</span>
              </div>
            </div>
            <span>
              {new Intl.DateTimeFormat("es-BO", {
                month: "short",
                timeZone: "UTC",
              }).format(new Date(`${i.month}-15T12:00:00Z`))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
export function Sparkline({
  observations,
}: {
  observations: { price: string; observed_at: string }[];
}) {
  const sorted = [...observations].sort(
    (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
  );
  if (!sorted.length)
    return (
      <span className="quiet">El historial aparecerá con tus registros.</span>
    );
  const values = sorted.map((q) => D(q.price).toNumber());
  const min = Math.min(...values),
    max = Math.max(...values),
    span = max - min || 1;
  const start = Date.parse(sorted[0].observed_at),
    duration = Date.parse(sorted.at(-1)!.observed_at) - start || 1;
  const points = values.map((v, i) => [
    sorted.length === 1
      ? 160
      : ((Date.parse(sorted[i].observed_at) - start) / duration) * 320,
    70 - ((v - min) / span) * 55,
  ]);
  const path = points
    .map(
      ([x, y], i) =>
        `${i && Date.parse(sorted[i].observed_at) - Date.parse(sorted[i - 1].observed_at) <= 900000 ? "L" : "M"}${x},${y}`,
    )
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 320 90"
      role="img"
      aria-label="Evolución de la referencia de venta de USDT"
    >
      <path d={path} fill="none" stroke="#83D6AF" strokeWidth="2" />
      {points.map(([x, y], i) => (
        <circle key={sorted[i].observed_at} cx={x} cy={y} r="3" fill="#83D6AF">
          <title>{displayObservation(sorted[i])}</title>
        </circle>
      ))}
    </svg>
  );
}
function displayObservation(q: { price: string; observed_at: string }) {
  return `${new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", dateStyle: "short", timeStyle: "short" }).format(new Date(q.observed_at))}: ${money(q.price)}`;
}
