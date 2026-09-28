import { NextResponse } from "next/server";
import { getState, apiError, ApiError } from "@/lib/api";
import { report, monthRange, monthNow } from "@/lib/finance";
export async function GET(r: Request) {
  try {
    const p = new URL(r.url).searchParams,
      range = monthRange(monthNow()),
      from = p.get("from") ?? range.from,
      to = p.get("to") ?? range.to;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
      from > to
    )
      throw new ApiError("Elige un período válido.");
    return NextResponse.json(
      report(
        await getState(),
        from,
        to,
        p.get("account") ?? "",
        p.get("category") ?? "",
      ),
    );
  } catch (e) {
    return apiError(e);
  }
}
