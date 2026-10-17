import { NextResponse } from "next/server";
import { serverSupabase } from "./supabase/server";
import { cloudConfigured } from "./supabase/browser";
import { commandSchema, movementSchema, entitySchemas } from "./commands";
import { planningSchema } from "./planning";
import { emptyState } from "./demo";
import type { FinanceState } from "./types";
import { recordFailure } from "./monitor";
import { ZodError } from "zod";
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function session() {
  if (!cloudConfigured())
    throw new ApiError("La nube aún no está configurada.", 503);
  const db = await serverSupabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) throw new ApiError("Inicia sesión para continuar.", 401);
  return { db, user };
}
export async function getState(): Promise<FinanceState> {
  const { db } = await session();
  const { data, error } = await db.rpc("read_finance_state");
  if (error) {
    recordFailure("sync.read", error.code);
    throw new ApiError(
      "No se pudo leer la base de datos. Comprueba que la migración esté aplicada.",
      503,
    );
  }
  const empty = emptyState();
  return {
    ...data,
    profile: data.profile ?? empty.profile,
    categories: data.profile ? data.categories : empty.categories,
  } as FinanceState;
}
export async function writeCommand(
  request: Request,
  allowed: string[],
  id?: string,
) {
  try {
    const { db } = await session();
    const origin = new URL(request.url).origin;
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      throw new ApiError("Origen no permitido.", 403);
    const c = commandSchema.parse(await request.json());
    if (!allowed.includes(c.type) || (id && c.id !== id))
      throw new ApiError("Operación inválida.");
    const validatePayload = (command: typeof c) => {
      if (command.type === "movement") movementSchema.parse(command.payload);
      if (command.type === "planning") planningSchema.parse(command.payload);
      if (command.type === "entity") {
        if (!command.entity) throw new ApiError("Falta el tipo de registro.");
        entitySchemas[command.entity].parse(command.payload);
      }
      if (command.type === "batch") {
        const children = command.payload.commands;
        if (
          !Array.isArray(children) ||
          children.length < 1 ||
          children.length > 1000
        )
          throw new ApiError(
            "El lote debe contener entre 1 y 1000 operaciones.",
          );
        command.payload.commands = children.map((raw) => {
          const child = commandSchema.parse(raw);
          if (!["movement", "void", "entity", "planning"].includes(child.type))
            throw new ApiError("Operación no permitida en lote.");
          validatePayload(child);
          return child;
        });
      }
    };
    validatePayload(c);
    const { data, error } = await db.rpc("apply_finance_command", {
      command: c,
    });
    if (error) {
      recordFailure("sync.command", error.code);
      throw new ApiError(
        error.message,
        error.message.includes("conflicto") ? 409 : 400,
      );
    }
    return NextResponse.json(data);
  } catch (e) {
    return apiError(e);
  }
}
export function apiError(e: unknown) {
  return NextResponse.json(
    {
      error:
        e instanceof ZodError
          ? "Revisa los campos obligatorios y los formatos de importe y fecha."
          : e instanceof ApiError
            ? e.message
            : e instanceof Error
              ? e.message
              : "No se pudo completar la operación.",
    },
    { status: e instanceof ApiError ? e.status : 400 },
  );
}
