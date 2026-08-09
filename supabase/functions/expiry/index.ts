import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { tg, rupiah } from "../_shared/telegram.ts";
import { retryCallbacks } from "../_shared/callback.ts";

// Dipanggil pg_cron tiap menit (via pg_net):
// 1. sweep invoice expired -> status expired + hapus pesan QR di chat
// 2. retry callback yang gagal (backoff, maks 5x)
Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (req.headers.get("X-Webhook-Secret") !== Deno.env.get("QRIS_HOOK_SECRET")) {
    return json(401, { error: "bad secret" });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  try {
    const now = new Date().toISOString();
    let cleaned = 0;
    const { data: rows } = await supabase
      .from("invoices").select("*")
      .eq("status", "pending").lt("expires_at", now)
      .limit(50);
    for (const inv of rows ?? []) {
      await supabase.from("invoices").update({ status: "expired" }).eq("id", inv.id);
      cleaned++;
      const ref: string | null = inv.reference;
      if (ref?.startsWith("tg") && inv.tg_msg_id) {
        const chat = Number(ref.slice(2));
        EdgeRuntime.waitUntil((async () => {
          await tg("deleteMessage", { chat_id: chat, message_id: inv.tg_msg_id });
          await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown", text:
            `⏰ QR *kedaluwarsa* — invoice \`${inv.id}\` (${rupiah(Number(inv.base_amount))}) dibatalkan.\nKirim nominal lagi untuk QR baru.` });
        })());
      }
    }
    const retried = await retryCallbacks(supabase);
    return json(200, { ok: true, expired: cleaned, callbacks_retried: retried });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
