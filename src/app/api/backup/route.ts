import { NextResponse } from "next/server";
import { session, apiError, ApiError } from "@/lib/api";
import { emptyState } from "@/lib/demo";
import { createBackup, MAX_BACKUP_BYTES, prepareRestore } from "@/lib/backup";
import type { FinanceState } from "@/lib/types";

async function current() {
  const { db, user } = await session();
  const { data, error } = await db.rpc("read_finance_backup");
  if (error)
    throw new ApiError(
      "No se pudo leer el espacio para generar el respaldo.",
      503,
    );
  const state = data.state.profile ? data.state : emptyState();
  return {
    db,
    user,
    state: state as FinanceState,
    revision: Number(data.revision),
  };
}
export async function GET() {
  try {
    const { state, user } = await current();
    return NextResponse.json(createBackup(state, user.id), {
      headers: {
        "Content-Disposition": `attachment; filename="saldo-respaldo-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
export async function POST(request: Request) {
  try {
    const origin = new URL(request.url).origin;
    if (
      request.headers.get("origin") &&
      request.headers.get("origin") !== origin
    )
      throw new ApiError("Origen no permitido.", 403);
    const text = await request.text();
    if (new TextEncoder().encode(text).length > MAX_BACKUP_BYTES)
      throw new ApiError("El archivo supera los 3 MB.", 413);
    const body = JSON.parse(text);
    const { db, user, state, revision } = await current();
    const plan = await prepareRestore(state, body.backup, user.id);
    const preview = {
      revision,
      added: plan.added,
      duplicates: plan.duplicates,
      counts: plan.counts,
      remapped: plan.remapped,
      pending: plan.pending,
      summary: plan.summary,
    };
    if (body.preview === true) return NextResponse.json(preview);
    if (body.expected_revision !== revision)
      throw new ApiError(
        "Tus datos cambiaron. Genera una nueva vista previa.",
        409,
      );
    if (!plan.added) return NextResponse.json({ ...preview, ok: true });
    const { error } = await db.rpc("apply_finance_command", {
      command: {
        id: crypto.randomUUID(),
        type: "restore",
        payload: { state: plan.delta, expected_revision: revision },
      },
    });
    if (error)
      throw new ApiError(
        error.message,
        error.message.includes("conflicto") ? 409 : 400,
      );
    return NextResponse.json({ ...preview, ok: true });
  } catch (e) {
    return apiError(e);
  }
}
