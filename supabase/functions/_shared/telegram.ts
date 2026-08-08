// Helper Telegram API
export async function tg(method: string, params: Record<string, unknown>): Promise<unknown> {
  const token = Deno.env.get("QRIS_BOT_TOKEN")!;
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) console.error("tg error", method, res.status, await res.text());
  return res.json().catch(() => null);
}

export function rupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}
