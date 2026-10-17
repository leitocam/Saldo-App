import { NextResponse } from "next/server";
import { apiError, ApiError, session } from "@/lib/api";
import { z } from "zod";
export async function GET() {
  try {
    const { db } = await session();
    const { data, error } = await db.rpc("read_shared_finance");
    if (error) throw new ApiError("No se pudieron leer los grupos.", 503);
    return NextResponse.json(data);
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      throw new ApiError("Origen no permitido.", 403);
    const { db } = await session();
    const text = await request.text();
    if (text.length > 100000)
      throw new ApiError("La operación supera el límite.", 413);
    const command = z
      .object({
        id: z.string().uuid(),
        group_id: z.string().uuid().optional(),
        action: z.enum([
          "create",
          "invite",
          "join",
          "expense",
          "void_expense",
          "settlement",
          "confirm",
          "cancel",
          "archive",
        ]),
        payload: z.record(z.string(), z.unknown()),
        expected_version: z.number().int().positive().optional(),
      })
      .parse(JSON.parse(text));
    const { data, error } = await db.rpc("shared_finance_command", { command });
    if (error)
      throw new ApiError(
        error.message,
        error.message.includes("conflicto") ? 409 : 400,
      );
    return NextResponse.json(data);
  } catch (e) {
    return apiError(e);
  }
}
