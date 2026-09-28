import { describe, expect, it } from "vitest";
import { AuthResponseError, readAuthResponse } from "../src/lib/auth-response";

describe("respuestas de acceso", () => {
  it("explica la protección de Vercel sin convertir el objeto en texto", async () => {
    const response = Response.json(
      {
        error: { code: "401", message: "Protected deployment" },
        protection: { vercel_auth_enabled: true },
      },
      { status: 401 },
    );
    await expect(readAuthResponse(response)).rejects.toMatchObject({
      requiresVercel: true,
      message: expect.stringContaining("Autorizar acceso"),
    });
  });

  it("conserva el mensaje de credenciales de la aplicación", async () => {
    await expect(
      readAuthResponse(
        Response.json(
          { error: "El correo o la contraseña no son correctos." },
          { status: 400 },
        ),
      ),
    ).rejects.toMatchObject({
      requiresVercel: false,
      message: "El correo o la contraseña no son correctos.",
    });
  });

  it("lee un mensaje de error estructurado", async () => {
    await expect(
      readAuthResponse(
        Response.json(
          { error: { message: "Servicio temporalmente no disponible." } },
          { status: 503 },
        ),
      ),
    ).rejects.toThrow("Servicio temporalmente no disponible.");
  });

  it("no confunde HTML ni JSON incompleto con un acceso correcto", async () => {
    await expect(
      readAuthResponse(new Response("<html>Login</html>")),
    ).rejects.toBeInstanceOf(AuthResponseError);
    await expect(readAuthResponse(Response.json({}))).rejects.toThrow(
      "respuesta de acceso válida",
    );
  });

  it("reconoce una redirección a la autenticación de Vercel", async () => {
    const response = new Response("<html>Login</html>");
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: "https://vercel.com/login" },
    });
    await expect(readAuthResponse(response)).rejects.toMatchObject({
      requiresVercel: true,
    });
  });

  it("distingue la confirmación pendiente de una sesión válida", async () => {
    await expect(
      readAuthResponse(Response.json({ confirmation: true })),
    ).resolves.toEqual({ confirmation: true });
    await expect(
      readAuthResponse(Response.json({ confirmation: false })),
    ).resolves.toEqual({ confirmation: false });
  });
});
