"use client";
import { useCallback, useEffect, useState } from "react";
import { useFinance } from "./finance-provider";
import { Button, ErrorMessage, Field, Modal, SectionHead } from "./ui";
import { D, csvCell, decimal, money, today } from "@/lib/finance";
import { equalShares, sharedBalances, type SharedGroup } from "@/lib/shared";
import { downloadFile } from "./data-tools";
export function SharedTools() {
  const { mode, state, userId, notify, switchMode } = useFinance();
  const [operationId, setOperationId] = useState(() => crypto.randomUUID());
  const [groups, setGroups] = useState<SharedGroup[]>([]),
    [selected, setSelected] = useState(""),
    [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [modal, setModal] = useState<
      "create" | "join" | "expense" | "settlement" | null
    >(null),
    [name, setName] = useState(""),
    [nickname, setNickname] = useState(state.profile.display_name),
    [code, setCode] = useState(""),
    [invite, setInvite] = useState<{ code: string; expires_at: string } | null>(
      null,
    ),
    [amount, setAmount] = useState(""),
    [date, setDate] = useState(today()),
    [note, setNote] = useState(""),
    [recipient, setRecipient] = useState(""),
    [custom, setCustom] = useState(false),
    [shares, setShares] = useState<Record<string, string>>({}),
    [participants, setParticipants] = useState<string[]>([]);
  const load = useCallback(async () => {
    if (mode !== "cloud") return;
    setLoading(true);
    try {
      const r = await fetch("/api/shared", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setGroups(d.groups);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [mode]);
  useEffect(() => {
    void load();
  }, [load]);
  const group = groups.find((g) => g.id === selected) ?? groups[0];
  const balances = group ? sharedBalances(group) : {};
  const person = (id: string) =>
    group?.members.find((m) => m.user_id === id)?.display_name ??
    "Participante";
  async function send(
    action: string,
    payload: Record<string, unknown>,
    id = crypto.randomUUID(),
    expected_version?: number,
  ) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/shared", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          action,
          payload,
          ...(group && action !== "create" && action !== "join"
            ? { group_id: group.id }
            : {}),
          ...(expected_version ? { expected_version } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      if (d.group_id) setSelected(d.group_id);
      return d;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  }
  const open = (type: typeof modal) => {
    setOperationId(crypto.randomUUID());
    setModal(type);
    setError("");
    setAmount("");
    setNote("");
    setDate(today());
    setCustom(false);
    setShares({});
    setParticipants(group?.members.map((m) => m.user_id) ?? []);
    setRecipient(
      group?.members.find(
        (m) => m.user_id !== userId && balances[m.user_id]?.gt(0),
      )?.user_id ?? "",
    );
  };
  const download = () => {
    if (!group) return;
    const rows = [
      ["Fecha", "Tipo", "Concepto", "Pagó", "BOB", "Participante", "Parte BOB"],
      ...group.expenses.flatMap((e) =>
        e.shares.map((s) => [
          e.date,
          e.voided ? "Gasto anulado" : "Gasto",
          e.note,
          person(e.paid_by),
          e.amount,
          person(s.user_id),
          s.amount,
        ]),
      ),
      ...group.settlements.map((s) => [
        s.date,
        `Liquidación ${s.status}`,
        `${person(s.from_id)} → ${person(s.to_id)}`,
        person(s.from_id),
        s.amount,
        person(s.to_id),
        s.amount,
      ]),
    ];
    downloadFile(
      `saldo-grupo-${group.id}.csv`,
      "\uFEFF" + rows.map((row) => row.map(csvCell).join(";")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  return (
    <section className="panel tools-panel">
      <SectionHead title="Gastos compartidos" />
      {mode !== "cloud" ? (
        <>
          <p className="quiet">
            Crea un grupo en tu cuenta de la nube e invita mediante un código de
            un solo uso. Cada integrante conserva privadas sus cuentas y
            movimientos personales.
          </p>
          <Button icon="Cloud" onClick={() => void switchMode("cloud")}>
            Usar compartidos en la nube
          </Button>
        </>
      ) : (
        <>
          <div className="inline-actions">
            <Button onClick={() => open("create")} disabled={busy}>
              Crear grupo
            </Button>
            <Button onClick={() => open("join")} disabled={busy}>
              Unirme con código
            </Button>
            <Button onClick={() => void load()} disabled={loading}>
              Actualizar grupos
            </Button>
          </div>
          {loading && <p role="status">Actualizando grupos…</p>}
          {group && (
            <>
              <Field label="Grupo compartido">
                <select
                  value={group.id}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setInvite(null);
                  }}
                >
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.archived ? " · Archivado" : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="quiet">
                Este registro calcula lo que cada persona debe. Los pagos reales
                se registran en las cuentas personales por separado; crear un
                gasto aquí no modifica ningún banco.
              </p>
              <div className="forecast-grid">
                {group.members.map((m) => (
                  <div key={m.user_id}>
                    <span>
                      {m.display_name}
                      {m.user_id === userId ? " · Tú" : ""}
                    </span>
                    <strong
                      className={
                        balances[m.user_id].gt(0)
                          ? "positive"
                          : balances[m.user_id].lt(0)
                            ? "danger"
                            : ""
                      }
                    >
                      {money(balances[m.user_id])}
                    </strong>
                    <small>
                      {balances[m.user_id].gt(0)
                        ? "Por recibir"
                        : balances[m.user_id].lt(0)
                          ? "Por pagar"
                          : "Al día"}
                    </small>
                  </div>
                ))}
              </div>
              <div className="inline-actions">
                <Button
                  disabled={busy || group.archived}
                  onClick={() => open("expense")}
                >
                  Añadir gasto que pagué
                </Button>
                <Button
                  disabled={busy || group.archived || !balances[userId]?.lt(0)}
                  onClick={() => open("settlement")}
                >
                  Registrar pago al grupo
                </Button>
                {group.owner_id === userId && (
                  <Button
                    disabled={busy || group.archived}
                    onClick={() =>
                      void send("invite", {})
                        .then((d) => setInvite(d))
                        .catch(() => {})
                    }
                  >
                    Generar invitación
                  </Button>
                )}
                <Button onClick={download}>Exportar grupo CSV</Button>
              </div>
              {invite && (
                <div className="preview-box">
                  <p>
                    Invitación de un solo uso · vence{" "}
                    {new Date(invite.expires_at).toLocaleDateString("es-BO")}
                  </p>
                  <Field label="Código de invitación">
                    <input value={invite.code} readOnly />
                  </Field>
                  <Button
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(invite.code)
                        .then(() => notify("Código copiado."))
                        .catch(() =>
                          setError("Selecciona y copia el código manualmente."),
                        )
                    }
                  >
                    Copiar código
                  </Button>
                  <p className="quiet">
                    Comparte este código solo con la persona que quieres
                    invitar.
                  </p>
                </div>
              )}
              <h4>Pagos entre integrantes</h4>
              <div className="tool-list">
                {group.settlements.map((s) => (
                  <div className="tool-row" key={s.id}>
                    <span className="tool-row-main">
                      <strong>
                        {person(s.from_id)} → {person(s.to_id)}
                      </strong>
                      <small>
                        {s.date} ·{" "}
                        {s.status === "pending"
                          ? "Pendiente de confirmar recepción"
                          : s.status === "confirmed"
                            ? "Recibido"
                            : "Cancelado"}
                      </small>
                    </span>
                    <strong>{money(s.amount)}</strong>
                    {s.status === "pending" && s.to_id === userId && (
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void send("confirm", {}, s.id, s.version)
                            .then(() => notify("Recepción confirmada."))
                            .catch(() => {})
                        }
                      >
                        Confirmar recepción
                      </Button>
                    )}
                    {s.status === "pending" &&
                      [s.from_id, s.to_id].includes(userId) && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void send("cancel", {}, s.id, s.version).catch(
                              () => {},
                            )
                          }
                        >
                          Cancelar pago
                        </Button>
                      )}
                  </div>
                ))}
              </div>
              <h4>Gastos del grupo</h4>
              <div className="tool-list">
                {group.expenses.map((e) => (
                  <div key={e.id} className="tool-row">
                    <span className="tool-row-main">
                      <strong>
                        {e.note}
                        {e.voided ? " · Anulado" : ""}
                      </strong>
                      <small>
                        {e.date} · Pagó {person(e.paid_by)}
                      </small>
                      <small>
                        {e.shares
                          .map(
                            (s) => `${person(s.user_id)}: ${money(s.amount)}`,
                          )
                          .join(" · ")}
                      </small>
                    </span>
                    <strong>{money(e.amount)}</strong>
                    {!e.voided &&
                      !group.archived &&
                      (e.created_by === userId ||
                        group.owner_id === userId) && (
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void send(
                              "void_expense",
                              {},
                              e.id,
                              e.version,
                            ).catch(() => {})
                          }
                        >
                          Anular gasto
                        </Button>
                      )}
                  </div>
                ))}
              </div>
              {group.owner_id === userId && !group.archived && (
                <Button
                  disabled={busy}
                  onClick={() => void send("archive", {}).catch(() => {})}
                >
                  Archivar grupo saldado
                </Button>
              )}
            </>
          )}
          {modal && (
            <Modal
              title={
                modal === "create"
                  ? "Crear grupo compartido"
                  : modal === "join"
                    ? "Unirme a un grupo"
                    : modal === "expense"
                      ? "Añadir gasto compartido"
                      : "Pago entre integrantes"
              }
              onClose={() => setModal(null)}
            >
              <form
                className="form-stack"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    if (modal === "create") {
                      const d = await send(
                        "create",
                        {
                          name,
                          display_name: nickname,
                        },
                        operationId,
                      );
                      setSelected(d.group_id);
                    } else if (modal === "join") {
                      const d = await send(
                        "join",
                        {
                          code: code.trim(),
                          display_name: nickname,
                        },
                        operationId,
                      );
                      setSelected(d.group_id);
                    } else if (modal === "expense") {
                      const total = decimal(amount);
                      const portions = custom
                        ? participants.map((user_id) => ({
                            user_id,
                            amount: decimal(shares[user_id] ?? "0"),
                          }))
                        : equalShares(total, participants);
                      if (
                        portions
                          .reduce((sum, s) => sum.plus(s.amount), D(0))
                          .cmp(total) !== 0
                      )
                        throw new Error("El reparto debe sumar el total.");
                      await send(
                        "expense",
                        {
                          amount: total,
                          note,
                          date,
                          shares: portions,
                        },
                        operationId,
                      );
                    } else
                      await send(
                        "settlement",
                        {
                          amount: decimal(amount),
                          to_id: recipient,
                          date,
                        },
                        operationId,
                      );
                    setModal(null);
                    notify("Registro compartido guardado.");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {modal === "create" && (
                  <Field label="Nombre del grupo">
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={80}
                      required
                    />
                  </Field>
                )}
                {(modal === "create" || modal === "join") && (
                  <Field label="Tu nombre visible en el grupo">
                    <input
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      maxLength={80}
                      required
                    />
                  </Field>
                )}
                {modal === "join" && (
                  <Field label="Código para unirme">
                    <input
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      required
                    />
                  </Field>
                )}
                {(modal === "expense" || modal === "settlement") && (
                  <>
                    <Field label="Importe compartido BOB">
                      <input
                        inputMode="decimal"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Fecha del registro compartido">
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        required
                      />
                    </Field>
                  </>
                )}
                {modal === "expense" && (
                  <>
                    <Field label="Concepto compartido">
                      <input
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        required
                      />
                    </Field>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={custom}
                        onChange={(e) => setCustom(e.target.checked)}
                      />
                      <span>Usar importes personalizados</span>
                    </label>
                    <p className="quiet">
                      Si el reparto es igual, los centavos sobrantes se
                      distribuyen de forma estable entre participantes.
                    </p>
                    {group?.members.map((m) => (
                      <div className="share-line" key={m.user_id}>
                        <label className="checkbox-row">
                          <input
                            type="checkbox"
                            checked={participants.includes(m.user_id)}
                            onChange={(e) =>
                              setParticipants(
                                e.target.checked
                                  ? [...participants, m.user_id]
                                  : participants.filter(
                                      (id) => id !== m.user_id,
                                    ),
                              )
                            }
                          />
                          <span>{m.display_name}</span>
                        </label>
                        {custom && participants.includes(m.user_id) && (
                          <Field label={`Parte BOB de ${m.display_name}`}>
                            <input
                              inputMode="decimal"
                              value={shares[m.user_id] ?? ""}
                              onChange={(e) =>
                                setShares({
                                  ...shares,
                                  [m.user_id]: e.target.value,
                                })
                              }
                              required
                            />
                          </Field>
                        )}
                      </div>
                    ))}
                  </>
                )}
                {modal === "settlement" && (
                  <>
                    <Field label="Persona que recibe el pago">
                      <select
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        required
                      >
                        <option value="">Elegir</option>
                        {group?.members
                          .filter(
                            (m) =>
                              m.user_id !== userId && balances[m.user_id].gt(0),
                          )
                          .map((m) => (
                            <option key={m.user_id} value={m.user_id}>
                              {m.display_name} · Por recibir{" "}
                              {money(balances[m.user_id])}
                            </option>
                          ))}
                      </select>
                    </Field>
                    <p className="quiet">
                      El saldo del grupo cambiará cuando quien recibe confirme
                      la recepción. Registra el movimiento bancario real en tus
                      cuentas personales.
                    </p>
                  </>
                )}
                <ErrorMessage error={error} />
                <div className="dialog-actions">
                  <Button
                    className="primary full"
                    type="submit"
                    disabled={busy}
                  >
                    {modal === "join"
                      ? "Unirme al grupo"
                      : "Guardar en el grupo"}
                  </Button>
                </div>
              </form>
            </Modal>
          )}
        </>
      )}
      <ErrorMessage error={error} />
    </section>
  );
}
