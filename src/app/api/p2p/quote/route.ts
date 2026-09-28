import { NextResponse } from "next/server";
import { fetchQuote } from "@/lib/p2p";
import { getState, apiError, session } from "@/lib/api";
import { quoteDefaults } from "@/lib/types";
import { cloudConfigured } from "@/lib/supabase/browser";
export async function GET() {
  try {
    const settings = cloudConfigured()
      ? (await getState()).profile.quote_settings
      : quoteDefaults;
    const result = await fetchQuote(settings);
    if (result.quote && cloudConfigured()) {
      const { db } = await session();
      const { error } = await db.rpc("apply_finance_command", {
        command: {
          id: result.quote.id,
          type: "entity",
          entity: "quote",
          payload: result.quote,
        },
      });
      if (error) throw error;
    }
    return NextResponse.json(result);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(r: Request) {
  try {
    const settings = (
      await import("@/lib/commands")
    ).entitySchemas.profile.shape.quote_settings.parse(await r.json());
    if (cloudConfigured()) await session();
    return NextResponse.json(await fetchQuote(settings));
  } catch (e) {
    return apiError(e);
  }
}
