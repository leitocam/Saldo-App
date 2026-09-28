// Only operational metadata. Never accept financial payloads or user descriptions.
export function recordFailure(
  event: "sync.command" | "sync.read" | "p2p.provider",
  code: string | number,
) {
  console.warn(
    JSON.stringify({
      event,
      code: String(code)
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 32),
      at: new Date().toISOString(),
    }),
  );
}
