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

export function formatWIB(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const wib = new Date(d.getTime() + 7 * 3600 * 1000);
  const days = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const p = (n: number) => String(n).padStart(2, "0");
  return `${days[wib.getUTCDay()]}, ${p(wib.getUTCDate())} ${months[wib.getUTCMonth()]} ${wib.getUTCFullYear()} ${p(wib.getUTCHours())}:${p(wib.getUTCMinutes())} WIB`;
}
