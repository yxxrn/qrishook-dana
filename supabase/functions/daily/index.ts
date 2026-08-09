import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { tg, rupiah } from "../_shared/telegram.ts";

// Ringkasan harian -> Telegram. Dipanggil pg_cron tiap hari 23:30 WIB (via pg_net).
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (req.headers.get("X-Webhook-Secret") !== Deno.env.get("QRIS_HOOK_SECRET")) {
    return json(401, { error: "bad secret" });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  const wibDate = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const start = new Date(`${wibDate}T00:00:00+07:00`).toISOString();

  const { data: paidRows } = await supabase
    .from("invoices").select("base_amount").eq("status", "paid").gte("paid_at", start);
  const paidCount = paidRows?.length ?? 0;
  const paidTotal = (paidRows ?? []).reduce((a, r) => a + Number(r.base_amount), 0);
  const { count: pPending } = await supabase
    .from("invoices").select("id", { count: "exact", head: true }).eq("status", "pending");
  const { count: pExpired } = await supabase
    .from("invoices").select("id", { count: "exact", head: true }).eq("status", "expired").gte("created_at", start);
  const { count: pEvents } = await supabase
    .from("events").select("id", { count: "exact", head: true }).gte("created_at", start);

  const text = `📊 *Ringkasan ${wibDate}*\n\n`
    + `✅ Lunas: ${paidCount} — ${rupiah(paidTotal)}\n`
    + `⏳ Pending sekarang: ${pPending ?? 0}\n`
    + `❌ Expired hari ini: ${pExpired ?? 0}\n`
    + `📥 Webhook masuk: ${pEvents ?? 0}`;

  const { data: chats } = await supabase.from("tg_chats").select("chat_id");
  for (const c of chats ?? []) {
    await tg("sendMessage", { chat_id: c.chat_id, parse_mode: "Markdown", text });
  }
  return json(200, { ok: true, sent_to: (chats ?? []).length });
});
