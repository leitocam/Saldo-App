"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Command, FinanceState, Pending } from "@/lib/types";
import { applyCommand } from "@/lib/commands";
import { demoState, emptyState } from "@/lib/demo";
import { readWorkspace, writeWorkspace, clearWorkspace } from "@/lib/storage";
import { browserSupabase, cloudConfigured } from "@/lib/supabase/browser";
import { deliver, rebase } from "@/lib/sync";
type Context = {
  state: FinanceState;
  ready: boolean;
  mode: "demo" | "local" | "cloud";
  online: boolean;
  pending: Pending[];
  userId: string;
  authRequired: boolean;
  message: string;
  undoAction: (() => Promise<void>) | null;
  dispatch: (c: Command) => Promise<void>;
  sync: () => Promise<void>;
  switchMode: (m: "demo" | "local" | "cloud") => Promise<void>;
  refreshAuth: () => Promise<void>;
  notify: (m: string, action?: () => Promise<void>) => void;
  signOut: () => Promise<void>;
  exitDemo: () => Promise<void>;
  discardPending: (id: string) => Promise<void>;
};
const FinanceContext = createContext<Context | null>(null);
export function FinanceProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FinanceState>(emptyState),
    [ready, setReady] = useState(false),
    [mode, setMode] = useState<Context["mode"]>("demo"),
    [online, setOnline] = useState(true),
    [pending, setPending] = useState<Pending[]>([]),
    [userId, setUserId] = useState("demo"),
    [authRequired, setAuthRequired] = useState(false),
    [message, setMessage] = useState(""),
    [undoAction, setUndoAction] = useState<(() => Promise<void>) | null>(null);
  const ref = useRef({
      state: emptyState(),
      pending: [] as Pending[],
      user: "demo",
      mode: "demo" as Context["mode"],
    }),
    syncing = useRef(false),
    persistence = useRef(Promise.resolve());
  const notify = useCallback((m: string, action?: () => Promise<void>) => {
    setMessage(m);
    setUndoAction(() => action ?? null);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => {
      setMessage("");
      setUndoAction(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [message]);
  const commit = useCallback(
    async (
      s: FinanceState,
      p: Pending[],
      user = ref.current.user,
      m = ref.current.mode,
    ) => {
      ref.current = { state: s, pending: p, user, mode: m };
      setState(s);
      setPending(p);
      setUserId(user);
      setMode(m);
      setReady(true);
      persistence.current = persistence.current
        .catch(() => {})
        .then(() => writeWorkspace(user, { state: s, pending: p }));
      await persistence.current;
    },
    [],
  );
  const sync = useCallback(async () => {
    if (
      ref.current.mode !== "cloud" ||
      !ref.current.user ||
      !navigator.onLine ||
      syncing.current
    )
      return;
    syncing.current = true;
    const syncUser = ref.current.user;
    try {
      for (;;) {
        const item = ref.current.pending.find((x) => x.status === "pending");
        if (!item) break;
        const c = item.command;
        const result = await deliver(c);
        if (ref.current.user !== syncUser || ref.current.mode !== "cloud")
          return;
        if (result.status === "retry") break;
        if (result.status !== "accepted") {
          if (result.status === "auth") {
            setAuthRequired(true);
            notify(
              "Vuelve a iniciar sesión para sincronizar. Tus registros siguen guardados.",
            );
            break;
          }
          const next = ref.current.pending.map((x) =>
            x === item
              ? {
                  ...x,
                  status: "failed" as const,
                  error: result.error,
                }
              : x,
          );
          await commit(ref.current.state, next);
          notify(result.error);
          continue;
        }
        const next = ref.current.pending.filter((x) => x !== item);
        await commit(ref.current.state, next);
      }
      const response = await fetch("/api/state", { cache: "no-store" });
      if (ref.current.user !== syncUser || ref.current.mode !== "cloud") return;
      if (response.ok) {
        const confirmed = (await response.json()) as FinanceState;
        if (ref.current.user !== syncUser || ref.current.mode !== "cloud")
          return;
        const next = rebase(confirmed, ref.current.pending);
        await commit(next.state, next.pending);
      }
    } catch {
      notify("La sincronización se reanudará cuando vuelva la conexión.");
    } finally {
      syncing.current = false;
    }
  }, [commit, notify]);
  const switchMode = useCallback(
    async (m: Context["mode"]) => {
      let id = m as string;
      if (m === "cloud") {
        if (!cloudConfigured()) {
          notify("La nube aún no está configurada. Puedes usar el modo local.");
          return;
        }
        localStorage.setItem("saldo-mode", "cloud");
        try {
          const {
            data: { user },
          } = await browserSupabase().auth.getUser();
          if (!user) {
            const cachedUser = !navigator.onLine
              ? localStorage.getItem("saldo-last-user")
              : null;
            if (!cachedUser) {
              setAuthRequired(true);
              return;
            }
            id = cachedUser;
            setAuthRequired(false);
          } else {
            id = user.id;
            localStorage.setItem("saldo-last-user", id);
            setAuthRequired(false);
          }
        } catch {
          const cachedUser = localStorage.getItem("saldo-last-user");
          if (!cachedUser) {
            setAuthRequired(true);
            return;
          }
          id = cachedUser;
          setAuthRequired(false);
        }
      } else setAuthRequired(false);
      localStorage.setItem("saldo-mode", m);
      const cached = await readWorkspace(id);
      await commit(
        cached?.state ?? (m === "demo" ? demoState() : emptyState()),
        cached?.pending ?? [],
        id,
        m,
      );
    },
    [commit, notify],
  );
  const refreshAuth = useCallback(async () => {
    await switchMode("cloud");
    await sync();
  }, [switchMode, sync]);
  useEffect(() => {
    const boot = async () => {
      try {
        if (
          cloudConfigured() &&
          localStorage.getItem("saldo-mode") !== "demo" &&
          localStorage.getItem("saldo-mode") !== "local"
        ) {
          await switchMode("cloud");
          if (ref.current.mode === "cloud") await sync();
          else setReady(true);
        } else
          await switchMode(
            localStorage.getItem("saldo-mode") === "local" ? "local" : "demo",
          );
      } catch {
        setReady(true);
        notify("No se pudo abrir el almacenamiento del dispositivo.");
      }
    };
    void boot();
    setOnline(navigator.onLine);
    const on = () => {
        setOnline(true);
        void sync();
      },
      off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if ("serviceWorker" in navigator)
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [switchMode, sync, notify]);
  useEffect(() => {
    if (mode === "cloud" && online) void sync();
  }, [mode, online, sync]);
  useEffect(() => {
    if (mode !== "cloud" || authRequired) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void sync();
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [mode, authRequired, sync]);
  const dispatch = useCallback(
    async (c: Command) => {
      const current = ref.current,
        next = applyCommand(current.state, c);
      if (
        current.mode === "cloud" &&
        (c.type === "void" || c.expected_version) &&
        (!navigator.onLine ||
          current.pending.some((p) => p.status === "pending")) &&
        !(
          c.type === "void" &&
          current.pending.some(
            (p) =>
              p.command.id === c.id &&
              p.command.type === "movement" &&
              p.status === "pending",
          )
        )
      )
        throw new Error("Sincroniza tus registros antes de editar.");
      const queue =
        current.mode === "cloud"
          ? [
              ...current.pending.filter(
                (p) => !(p.command.id === c.id && p.status === "failed"),
              ),
              { command: c, status: "pending" as const },
            ]
          : current.pending;
      await commit(next, queue);
      if (current.mode === "cloud") void sync();
    },
    [commit, sync],
  );
  const openLogin = useCallback(() => {
    const empty = emptyState();
    localStorage.setItem("saldo-mode", "cloud");
    ref.current = { state: empty, pending: [], user: "", mode: "cloud" };
    setState(empty);
    setPending([]);
    setUserId("");
    setMode("cloud");
    setMessage("");
    setUndoAction(null);
    setAuthRequired(true);
  }, []);
  const exitDemo = useCallback(async () => {
    if (ref.current.mode !== "demo") return;
    await persistence.current;
    openLogin();
  }, [openLogin]);
  const signOut = useCallback(async () => {
    if (ref.current.pending.length)
      throw new Error(
        "Sincroniza o revisa tus registros pendientes antes de salir.",
      );
    const currentUser = ref.current.user;
    if (cloudConfigured()) {
      const { error } = await browserSupabase().auth.signOut({
        scope: "local",
      });
      if (error)
        throw new Error(
          "No se pudo cerrar sesión. Comprueba tu conexión e inténtalo de nuevo.",
        );
    }
    openLogin();
    localStorage.removeItem("saldo-last-user");
    await persistence.current;
    await clearWorkspace(currentUser);
  }, [openLogin]);
  const discardPending = useCallback(
    async (id: string) => {
      const current = ref.current;
      if (
        !current.pending.some(
          (p) => p.command.id === id && p.status === "failed",
        )
      )
        throw new Error("Solo se pueden descartar registros rechazados.");
      await commit(
        current.state,
        current.pending.filter((p) => p.command.id !== id),
      );
      await sync();
    },
    [commit, sync],
  );
  return (
    <FinanceContext.Provider
      value={{
        state,
        ready,
        mode,
        online,
        pending,
        userId,
        authRequired,
        message,
        undoAction,
        dispatch,
        sync,
        switchMode,
        refreshAuth,
        notify,
        signOut,
        exitDemo,
        discardPending,
      }}
    >
      {children}
    </FinanceContext.Provider>
  );
}
export function useFinance() {
  const ctx = useContext(FinanceContext);
  if (!ctx) throw new Error("FinanceProvider missing");
  return ctx;
}
