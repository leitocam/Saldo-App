"use client";
import { useEffect, useState } from "react";
import { Button, ErrorMessage, Field } from "./ui";
import { browserSupabase, cloudConfigured } from "@/lib/supabase/browser";
export function RecoveryRequest({ onBack }: { onBack: () => void }) {
  const [enabled, setEnabled] = useState<boolean | null>(null),
    [email, setEmail] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/auth/recovery", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (active) setEnabled(d.enabled === true);
      })
      .catch(() => {
        if (active) {
          setEnabled(false);
          setError("No se pudo comprobar el servicio de recuperación.");
        }
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="auth-screen recovery-screen">
      <form
        className="auth-form form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/auth/recovery", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setMessage(d.message);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="eyebrow">RECUPERA TU ACCESO</p>
        <h1>Vuelve a tu espacio.</h1>
        <p className="quiet">
          Recibirás un enlace para definir una contraseña nueva.
        </p>
        {enabled === false && (
          <p className="form-callout">
            El flujo está preparado. El envío se habilitará cuando se configure
            el proveedor de correo.
          </p>
        )}
        <Field label="Correo de recuperación">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>
        <ErrorMessage error={error} />
        {message && (
          <p role="status" className="form-callout">
            {message}
          </p>
        )}
        <Button
          type="submit"
          className="primary full"
          disabled={busy || enabled !== true}
        >
          {enabled === null
            ? "Comprobando servicio…"
            : "Enviar enlace de recuperación"}
        </Button>
        <Button onClick={onBack}>Volver al inicio de sesión</Button>
      </form>
    </div>
  );
}
export function RecoveryForm() {
  const [session, setSession] = useState<boolean | null>(null),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState(false);
  useEffect(() => {
    let active = true;
    if (!cloudConfigured()) {
      setSession(false);
      return;
    }
    browserSupabase()
      .auth.getUser()
      .then(({ data, error }) => {
        if (active) setSession(!error && !!data.user);
      })
      .catch(() => {
        if (active) setSession(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <div className="auth-screen recovery-screen">
      <form
        className="auth-form form-stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/auth/password", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ password, confirmation }),
            });
            const data = await r.json();
            if (!r.ok) throw new Error(data.error);
            setDone(true);
            setPassword("");
            setConfirmation("");
            localStorage.setItem("saldo-mode", "cloud");
            if (data.signOutPending)
              setError(
                "La contraseña cambió. Cierra las sesiones abiertas desde tus dispositivos.",
              );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="eyebrow">TU ACCESO</p>
        <h1>
          {done ? "Contraseña actualizada" : "Elige una contraseña nueva"}
        </h1>
        {session === null ? (
          <p>Comprobando tu enlace…</p>
        ) : !session ? (
          <p className="form-callout">
            El enlace venció o no hay una sesión válida. Solicita otro desde el
            inicio de sesión.
          </p>
        ) : !done ? (
          <>
            <Field label="Nueva contraseña">
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Field label="Repetir nueva contraseña">
              <input
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" className="primary" disabled={busy}>
              Guardar contraseña
            </Button>
          </>
        ) : (
          <p>Vuelve a entrar con tu nueva contraseña.</p>
        )}
        <ErrorMessage error={error} />
        <a className="btn" href="/">
          Volver a Saldo
        </a>
      </form>
    </div>
  );
}
