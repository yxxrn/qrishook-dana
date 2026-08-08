import { createClient } from "jsr:@supabase/supabase-js@2";
import { convert } from "../_shared/qris.ts";

const cache = { key: "", png: new Uint8Array() };

async function validToken(invId: string, token: string | null): Promise<boolean> {
  if (!token) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(Deno.env.get("QRIS_HOOK_SECRET")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(invId));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  // constant-time compare
  const a = new TextEncoder().encode(expected);
  const b = new TextEncoder().encode(token);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const invId = url.searchParams.get("invoice_id") || "";
  const token = url.searchParams.get("t") || null;
  if (!invId || !(await validToken(invId, token))) return new Response("not found", { status: 404 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  const { data } = await supabase.from("invoices").select("amount,status").eq("id", invId).maybeSingle();
  if (!data) return new Response("invoice not found", { status: 404 });
  if (data.status !== "pending") return new Response("invoice not active", { status: 404 });
  const payload = convert(data.amount);
  const cacheKey = `${invId}:${payload}`;
  if (cache.key !== cacheKey) {
    // @ts-ignore npm specifier di Deno edge
    const QRCode = (await import("npm:qrcode@1.5.4")).default;
    cache.png = await QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 1, width: 570 });
    cache.key = cacheKey;
  }
  return new Response(cache.png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
});
