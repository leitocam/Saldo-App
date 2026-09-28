import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({
  serverSupabase: async () => ({ auth }),
}));
vi.mock("@/lib/supabase/browser", () => ({ cloudConfigured: () => true }));

import { POST } from "../src/app/api/auth/route";
import { session } from "../src/lib/api";

const request = (action: string, email = "otra-persona@example.com") =>
  new Request("https://saldo.example/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, email, password: "test-only-password" }),
  });

beforeEach(() => {
  vi.resetAllMocks();
  // A stale deployment variable must not restore the old one-owner restriction.
  vi.stubEnv("OWNER_EMAIL", "antiguo-propietario@example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe("acceso con cuentas independientes", () => {
  it("registra otro correo y permite entrar directamente cuando Supabase da sesión", async () => {
    auth.signUp.mockResolvedValue({
      data: { session: { user: { id: "second-user" } } },
      error: null,
    });
    const response = await POST(
      request("signup", " otra-persona@example.com "),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ confirmation: false });
    expect(auth.signUp).toHaveBeenCalledWith({
      email: "otra-persona@example.com",
      password: "test-only-password",
      options: { emailRedirectTo: "https://saldo.example/auth/callback" },
    });
  });

  it("acepta el login de otro correo y devuelve un error claro si la contraseña falla", async () => {
    auth.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: { code: "invalid_credentials" },
    });
    const response = await POST(request("signin"));
    expect(auth.signInWithPassword).toHaveBeenCalled();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "El correo o la contraseña no son correctos.",
    });
  });

  it("rechaza una acción desconocida antes de llamar a Supabase", async () => {
    const response = await POST(request("delete"));
    expect(response.status).toBe(400);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("autoriza las rutas privadas para otro usuario autenticado", async () => {
    const user = { id: "second-user", email: "otra-persona@example.com" };
    auth.getUser.mockResolvedValue({ data: { user }, error: null });
    expect((await session()).user).toEqual(user);
  });

  it("mantiene el rechazo a las lecturas sin sesión", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(session()).rejects.toMatchObject({ status: 401 });
  });
});
