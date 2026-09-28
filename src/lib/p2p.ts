import { D } from "./finance";
import type { QuoteSettings } from "./types";
import { uid } from "./demo";
import { recordFailure } from "./monitor";
export type PaymentMethod = { identifier: string; tradeMethodName: string };
export type Ad = {
  adNo: string;
  price: string | number;
  minTransAmount: string | number;
  maxTransAmount: string | number;
  tradableAmount: string | number;
  tradeMethods: string[];
  advertiser: {
    nickName: string;
    userType: string;
    monthOrderCount: number;
    monthFinishRate: number;
    positiveRate: number;
  };
};
const base = "https://www.binance.com/bapi/c2c/v1/public/c2c/agent";
async function get(path: string, params: Record<string, string>) {
  const response = await fetch(
    `${base}/${path}?${new URLSearchParams(params)}`,
    {
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 300 },
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) {
    recordFailure("p2p.provider", response.status);
    throw new Error("Binance no está disponible en este momento.");
  }
  const data = await response.json();
  if (!data.success) {
    recordFailure("p2p.provider", "invalid_response");
    throw new Error("Binance no pudo proporcionar una referencia.");
  }
  return data.data;
}
export async function paymentMethods(): Promise<PaymentMethod[]> {
  return get("trade-methods", { fiat: "BOB" });
}
export function selectAds(ads: Ad[], s: QuoteSettings) {
  const unique = new Map<string, Ad>();
  for (const a of [...ads].sort((a, b) => D(b.price).cmp(a.price))) {
    const fiat = D(s.quantity).mul(a.price),
      merchant = a.advertiser;
    if (
      merchant.userType !== "merchant" ||
      merchant.monthOrderCount < s.min_orders ||
      merchant.monthFinishRate < s.min_completion ||
      merchant.positiveRate < s.min_positive ||
      D(a.tradableAmount).lt(s.quantity) ||
      fiat.lt(a.minTransAmount) ||
      fiat.gt(a.maxTransAmount) ||
      (s.banks.length && !a.tradeMethods.some((x) => s.banks.includes(x)))
    )
      continue;
    if (!unique.has(merchant.nickName)) unique.set(merchant.nickName, a);
    if (unique.size === 5) break;
  }
  const eligible = [...unique.values()];
  if (eligible.length < 3) return { price: null, count: eligible.length };
  const prices = eligible.map((a) => D(a.price)).sort((a, b) => a.cmp(b));
  const n = prices.length,
    price =
      n % 2
        ? prices[Math.floor(n / 2)]
        : prices[n / 2 - 1].plus(prices[n / 2]).div(2);
  return { price: price.toFixed(8), count: n };
}
export async function fetchQuote(settings: QuoteSettings) {
  const methods = await paymentMethods();
  const allowed = new Set(methods.map((m) => m.identifier));
  if (settings.banks.some((b) => !allowed.has(b)))
    throw new Error("Actualiza los bancos de tu referencia P2P.");
  const filters = settings.banks.length ? settings.banks : [""];
  const lists = await Promise.all(
    filters.map((bank) =>
      get("ad-list", {
        fiat: "BOB",
        asset: "USDT",
        tradeType: "SELL",
        limit: "20",
        ...(bank ? { tradeMethodIdentifiers: bank } : {}),
      }),
    ),
  );
  const ads = lists.flatMap((d) => d.items ?? []) as Ad[];
  const selection = selectAds(ads, settings);
  if (!selection.price)
    return {
      quote: null,
      methods,
      status: "insufficient",
      sample_count: selection.count,
      message:
        "No hay al menos tres comerciantes que cumplan tus filtros. Se conserva tu última referencia.",
    };
  return {
    quote: {
      id: uid(),
      price: selection.price,
      observed_at: new Date().toISOString(),
      source: "binance" as const,
      sample_count: selection.count,
      quantity: settings.quantity,
      banks: settings.banks,
    },
    methods,
    status: "available",
    sample_count: selection.count,
  };
}
