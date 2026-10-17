import { beforeEach, afterEach, it, expect, vi } from "vitest";
const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  serverSupabase: async () => ({ auth }),
}));
vi.mock("@/lib/supabase/browser", () => ({ cloudConfigured: () => true }));
import {
  GET as status,
  POST as reset,
} from "../src/app/api/auth/recovery/route";
import { POST as password } from "../src/app/api/auth/password/route";
import { GET as callback } from "../src/app/auth/callback/route";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PASSWORD_RECOVERY_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());
const request = (
  path: string,
  body: unknown,
  origin = "https://saldo.example",
) =>
  new Request(`https://saldo.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
it("deja recuperación preparada y no envía correos sin activar SMTP", async () => {
  expect(await (await status()).json()).toEqual({ enabled: false });
  expect(
    (
      await reset(
        request("/api/auth/recovery", { email: "persona@example.com" }),
      )
    ).status,
  ).toBe(503);
  expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
});
it("el flujo activado usa PKCE y un mensaje que no revela si existe la cuenta", async () => {
  vi.stubEnv("PASSWORD_RECOVERY_ENABLED", "true");
  auth.resetPasswordForEmail.mockResolvedValue({ error: null });
  const r = await reset(
    request("/api/auth/recovery", { email: "persona@example.com" }),
  );
  expect(r.status).toBe(200);
  expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(
    "persona@example.com",
    { redirectTo: "https://saldo.example/auth/callback?next=/recover" },
  );
  expect((await r.json()).message).toContain("Si existe una cuenta");
});
it("rechaza origen ajeno y cambio de contraseña sin sesión", async () => {
  expect(
    (
      await reset(
        request(
          "/api/auth/recovery",
          { email: "persona@example.com" },
          "https://otro.example",
        ),
      )
    ).status,
  ).toBe(403);
  auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect(
    (
      await password(
        request("/api/auth/password", {
          password: "nueva-clave-larga",
          confirmation: "nueva-clave-larga",
        }),
      )
    ).status,
  ).toBe(401);
  expect(auth.updateUser).not.toHaveBeenCalled();
});
it("cambia solo la contraseña del usuario validado y revoca sus sesiones de actualización", async () => {
  auth.getUser.mockResolvedValue({
    data: { user: { id: "owner" } },
    error: null,
  });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
  const r = await password(
    request("/api/auth/password", {
      password: "nueva-clave-larga",
      confirmation: "nueva-clave-larga",
    }),
  );
  expect(r.status).toBe(200);
  expect(auth.updateUser).toHaveBeenCalledWith({
    password: "nueva-clave-larga",
  });
  expect(auth.signOut).toHaveBeenCalledWith({ scope: "global" });
});
it("el callback no permite redirecciones externas", async () => {
  auth.exchangeCodeForSession.mockResolvedValue({ error: null });
  const r = await callback(
    new Request(
      "https://saldo.example/auth/callback?code=ok&next=https://evil.example",
    ),
  );
  expect(r.headers.get("location")).toBe("https://saldo.example/");
  const recovery = await callback(
    new Request("https://saldo.example/auth/callback?code=ok&next=/recover"),
  );
  expect(recovery.headers.get("location")).toBe(
    "https://saldo.example/recover",
  );
});
