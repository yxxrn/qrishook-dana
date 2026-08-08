import { createClient } from "jsr:@supabase/supabase-js@2";
import { convert } from "../_shared/qris.ts";

const cache = { payload: "", png: new Uint8Array() };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const invId = url.searchParams.get("invoice_id") || "";
  if (!invId) return new Response("missing invoice_id", { status: 400 });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  const { data } = await supabase.from("invoices").select("amount,status").eq("id", invId).maybeSingle();
  if (!data) return new Response("invoice not found", { status: 404 });
  if (data.status !== "pending") return new Response("invoice not active", { status: 404 });
  const payload = convert(data.amount);
  if (cache.payload !== payload) {
    // @ts-ignore npm specifier di Deno edge
    const QRCode = (await import("npm:qrcode@1.5.4")).default;
    cache.png = await QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 1, width: 570 });
    cache.payload = payload;
  }
  return new Response(cache.png, {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" },
  });
});
