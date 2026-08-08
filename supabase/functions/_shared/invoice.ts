// Buat invoice + generate QRIS dinamis. Dipakai fungsi invoice & bot.
import { convert } from "./qris.ts";

export async function createInvoice(supabase: any, amount: number, reference: string | null, callbackUrl: string | null, callbackSecret: string | null, expiresIn: number) {
  const cap = amount > 10000 ? 200 : 50;
  const maxCode = Math.max(1, Math.min(cap, Math.floor(amount / 20)));
  let charged = 0;
  for (let i = 0; i < 200; i++) {
    const c = amount + 1 + Math.floor(Math.random() * maxCode);
    const { data } = await supabase.from("invoices").select("id").eq("amount", c).eq("status", "pending").maybeSingle();
    if (!data) { charged = c; break; }
  }
  if (!charged) throw new Error("collision creating invoice");
  const invId = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;
  const { error } = await supabase.from("invoices").insert({
    id: invId, amount: charged, base_amount: amount, reference, callback_url: callbackUrl,
    callback_secret: callbackSecret, expires_at: expiresAt, status: "pending",
  });
  if (error) throw error;
  // token QR: hanya pemilik secret yang bisa menghasilkan URL QR yang valid
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("QRIS_HOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(invId));
  const token = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const qrisUrl = `${Deno.env.get("QRIS_PUBLIC_URL")}/functions/v1/qris?invoice_id=${invId}&t=${token}`;
  return { invoice_id: invId, amount, charged_amount: charged, reference, status: "pending",
           expires_at: expiresAt, expires_in: expiresIn, qris_payload: convert(charged), qris_url: qrisUrl };
}
