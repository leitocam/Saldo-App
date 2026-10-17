import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { ApiError, apiError } from "@/lib/api";
import { z } from "zod";
const enabled = () => process.env.PASSWORD_RECOVERY_ENABLED === "true";
export async function GET() {
  return NextResponse.json(
    { enabled: enabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      throw new ApiError("Origen no permitido.", 403);
    if (!enabled())
      throw new ApiError(
        "La recuperación por correo está preparada. Falta configurar el servicio de envío.",
        503,
      );
    const { email } = z
      .object({ email: z.string().trim().email().max(254) })
      .parse(await request.json());
    const db = await serverSupabase();
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/recover`,
    });
    if (error)
      throw new ApiError(
        "No se pudo solicitar el correo. Espera unos minutos e inténtalo de nuevo.",
        error.status === 429 ? 429 : 503,
      );
    return NextResponse.json({
      message:
        "Si existe una cuenta con ese correo, recibirás un enlace para cambiar tu contraseña.",
    });
  } catch (e) {
    return apiError(e);
  }
}
