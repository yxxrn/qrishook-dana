import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { tg } from "../_shared/telegram.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (req.headers.get("X-Webhook-Secret") !== Deno.env.get("QRIS_HOOK_SECRET")) {
    return json(401, { error: "bad secret" });
  }
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  await supabase.from("events").insert({ payload: body });

  const amount = body?.payment?.amount;
  const sender = body?.payment?.sender_name ?? null;
  const eventId = body?.event_id ?? null;

  if (Number.isInteger(amount) && amount > 0) {
    const now = new Date().toISOString();
    const { data: inv } = await supabase
      .from("invoices")
      .select("*")
      .eq("amount", amount)
      .eq("status", "pending")
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (inv) {
      await supabase.from("invoices").update({
        status: "paid", sender_name: sender, event_id: eventId, paid_at: now,
      }).eq("id", inv.id);

      // konfirmasi bot untuk invoice dari Telegram (reference = tg<chat_id>)
      const ref: string | null = inv.reference;
      if (ref && ref.startsWith("tg")) {
        EdgeRuntime.waitUntil(tg("sendMessage", {
          chat_id: Number(ref.slice(2)), parse_mode: "Markdown",
          text: `✅ *Lunas!*\nInvoice: \`${inv.id}\`\nNominal: Rp${Number(inv.amount).toLocaleString("id-ID")}`,
        }));
      }
      // callback eksternal
      if (inv.callback_url) {
        EdgeRuntime.waitUntil((async () => {
          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (inv.callback_secret) headers["X-Callback-Secret"] = inv.callback_secret;
          try {
            await fetch(inv.callback_url, {
              method: "POST", headers, body: JSON.stringify({
                invoice_id: inv.id, amount: inv.amount, base_amount: inv.base_amount,
                reference: inv.reference, status: "paid", sender_name: sender,
                event_id: eventId, paid_at: now,
              }),
            });
          } catch (e) { console.error("callback failed", e); }
        })());
      }
      return json(200, { ok: true, matched: inv.id });
    }
  }

  // pembayaran tak dikenal -> alert ke semua chat terdaftar
  EdgeRuntime.waitUntil((async () => {
    const { data: chats } = await supabase.from("tg_chats").select("chat_id");
    if (!chats?.length) return;
    const txt = `⚠️ *Pembayaran tanpa invoice aktif*\nNominal: Rp${Number(amount).toLocaleString("id-ID")}`
      + "\nQR expired/cancel atau nominal tidak dikenal.";
    for (const c of chats) {
      await tg("sendMessage", { chat_id: c.chat_id, parse_mode: "Markdown", text: txt });
    }
  })());

  return json(200, { ok: true, matched: null });
});
