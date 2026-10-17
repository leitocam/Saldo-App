import { NextResponse } from "next/server";
import { session, apiError, ApiError } from "@/lib/api";
import { z } from "zod";
export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      throw new ApiError("Origen no permitido.", 403);
    const { db } = await session();
    const { password, confirmation } = z
      .object({
        password: z.string().min(8).max(128),
        confirmation: z.string(),
      })
      .parse(await request.json());
    if (password !== confirmation)
      throw new ApiError("Las contraseñas no coinciden.");
    const { error } = await db.auth.updateUser({ password });
    if (error)
      throw new ApiError(
        "No se pudo cambiar la contraseña. Solicita un enlace nuevo o elige una contraseña diferente.",
      );
    const { error: signOutError } = await db.auth.signOut({ scope: "global" });
    return NextResponse.json({ ok: true, signOutPending: !!signOutError });
  } catch (e) {
    return apiError(e);
  }
}
