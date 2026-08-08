import { createClient } from "jsr:@supabase/supabase-js@2";
import { json } from "../_shared/http.ts";
import { tg, rupiah } from "../_shared/telegram.ts";
import { createInvoice } from "../_shared/invoice.ts";

const EXPIRES = 900;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  // verifikasi asal update = Telegram
  if (req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== Deno.env.get("TG_SECRET_TOKEN")) {
    return json(401, { error: "bad secret" });
  }
  const update: any = await req.json().catch(() => null);
  if (!update?.message?.text) return json(200, { ok: true });

  const chat = update.message.chat.id;
  const text = String(update.message.text).trim();
  const low = text.toLowerCase();
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  await supabase.from("tg_chats").upsert({ chat_id: chat }, { onConflict: "chat_id" });

  if (low === "/start" || low === "/help") {
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown", text:
      "🏪 *QRIS Gateway - yxrn store*\n\nKirim nominal, contoh: `15000` atau `/pay 15000`\n\n`/status <id>` - cek invoice\n`/cancel <id>` - batalkan\n\nQR berlaku 15 menit. Konfirmasi otomatis setelah lunas." });
    return json(200, { ok: true });
  }

  let arg = text;
  if (low.startsWith("/status")) {
    const inv = text.split(/\s+/)[1] || "";
    if (!inv) { await tg("sendMessage", { chat_id: chat, text: "Format: /status <invoice_id>" }); return json(200, { ok: true }); }
    const { data } = await supabase.from("invoices").select("*").eq("id", inv).maybeSingle();
    if (!data) { await tg("sendMessage", { chat_id: chat, text: "❌ Invoice tidak ditemukan" }); return json(200, { ok: true }); }
    const extra = Number(data.amount) - Number(data.base_amount);
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown", text:
      `📄 *${data.id}*\nStatus: *${data.status}*\nNominal: ${rupiah(Number(data.base_amount))} (+ kode ${extra} = ${rupiah(Number(data.amount))})`
      + (data.paid_at ? `\nLunas: ${data.paid_at}` : "") });
    return json(200, { ok: true });
  }
  if (low.startsWith("/cancel")) {
    const inv = text.split(/\s+/)[1] || "";
    if (!inv) { await tg("sendMessage", { chat_id: chat, text: "Format: /cancel <invoice_id>" }); return json(200, { ok: true }); }
    const { data } = await supabase.from("invoices").update({ status: "cancelled" })
      .eq("id", inv).eq("status", "pending").select().maybeSingle();
    if (data?.tg_msg_id) await tg("deleteMessage", { chat_id: chat, message_id: data.tg_msg_id });
    await tg("sendMessage", { chat_id: chat, text: data ? "✅ Invoice dibatalkan (QR dihapus)" : "❌ Tidak ditemukan / sudah tidak pending" });
    return json(200, { ok: true });
  }
  if (low.startsWith("/pay")) arg = text.slice(4).trim();
  if (!/^\d+$/.test(arg)) {
    await tg("sendMessage", { chat_id: chat, parse_mode: "Markdown", text: "Kirim nominal angka, contoh: `15000`" });
    return json(200, { ok: true });
  }
  const amount = Number(arg);
  if (amount < 100 || amount > 10_000_000) {
    await tg("sendMessage", { chat_id: chat, text: "Nominal 100 - 10.000.000" });
    return json(200, { ok: true });
  }
  try {
    const inv = await createInvoice(supabase, amount, `tg${chat}`, null, null, EXPIRES);
    const extra = inv.charged_amount - amount;
    const sent = await tg("sendPhoto", {
      chat_id: chat, photo: inv.qris_url, parse_mode: "Markdown",
      caption: `🧾 *${inv.invoice_id}*\n\nBayar: *${rupiah(inv.charged_amount)}*\n(= ${rupiah(amount)} + kode ${extra})\n\nScan QR di atas. Berlaku 15 menit.\nKonfirmasi otomatis setelah lunas ✅`,
    });
    // simpan message_id supaya bisa dihapus saat expired
    const msgId = (sent as any)?.result?.message_id;
    if (msgId) {
      await supabase.from("invoices").update({ tg_msg_id: msgId }).eq("id", inv.invoice_id);
    }
  } catch (e) {
    await tg("sendMessage", { chat_id: chat, text: `❌ Gagal buat invoice: ${e}` });
  }
  return json(200, { ok: true });
});
