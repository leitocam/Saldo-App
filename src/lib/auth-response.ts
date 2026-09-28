export class AuthResponseError extends Error {
  constructor(
    message: string,
    public requiresVercel = false,
  ) {
    super(message);
  }
}

const protectedMessage =
  "Vercel necesita autorizar el acceso privado a esta página. Pulsa «Autorizar acceso» e inicia sesión en Vercel; después vuelve a crear tu acceso en Saldo.";

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export async function readAuthResponse(
  response: Response,
): Promise<{ confirmation: boolean }> {
  const payload = object(await response.json().catch(() => null));
  const error = object(payload?.error);
  const protection = object(payload?.protection);
  if (
    protection?.vercel_auth_enabled === true ||
    error?.message === "Protected deployment" ||
    (response.redirected && response.url.startsWith("https://vercel.com/"))
  ) {
    throw new AuthResponseError(protectedMessage, true);
  }
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : typeof error?.message === "string"
          ? error.message
          : "No se pudo completar el acceso. Recarga la página e inténtalo de nuevo.";
    throw new AuthResponseError(message.slice(0, 500));
  }
  if (typeof payload?.confirmation !== "boolean") {
    throw new AuthResponseError(
      "La página no devolvió una respuesta de acceso válida. Recarga la página e inténtalo de nuevo.",
    );
  }
  return { confirmation: payload.confirmation };
}
