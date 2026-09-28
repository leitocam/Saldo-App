import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { apiError, ApiError } from "@/lib/api";
import { cloudConfigured } from "@/lib/supabase/browser";
export async function POST(r: Request) {
  try {
    if (!cloudConfigured())
      throw new ApiError(
        "Configura Supabase para activar el acceso privado.",
        503,
      );
    const { email: submittedEmail, password, action } = await r.json();
    const email =
      typeof submittedEmail === "string"
        ? submittedEmail.trim()
        : submittedEmail;
    if (
      typeof email !== "string" ||
      !email.includes("@") ||
      typeof password !== "string" ||
      password.length < 8 ||
      (action !== "signup" && action !== "signin")
    )
      throw new ApiError(
        "Usa un correo válido y una contraseña de al menos ocho caracteres.",
      );
    const db = await serverSupabase();
    const result =
      action === "signup"
        ? await db.auth.signUp({
            email,
            password,
            options: {
              emailRedirectTo: `${new URL(r.url).origin}/auth/callback`,
            },
          })
        : await db.auth.signInWithPassword({ email, password });
    if (result.error)
      throw new ApiError(
        result.error.code === "invalid_credentials"
          ? "El correo o la contraseña no son correctos."
          : result.error.code === "email_not_confirmed"
            ? "Confirma tu correo antes de iniciar sesión."
            : "No se pudo completar el acceso. Comprueba tus datos e inténtalo de nuevo.",
      );
    return NextResponse.json({ confirmation: !result.data.session });
  } catch (e) {
    return apiError(e);
  }
}
