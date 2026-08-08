import { createClient } from "jsr:@supabase/supabase-js@2";
import { createInvoice } from "../_shared/invoice.ts";
import { json } from "../_shared/http.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json(200, {});
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (req.headers.get("X-Webhook-Secret") !== Deno.env.get("QRIS_HOOK_SECRET")) {
    return json(401, { error: "bad secret" });
  }
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "invalid JSON" }); }
  const amount = body.amount;
  if (!Number.isInteger(amount) || amount <= 0) return json(400, { error: "amount must be positive int (IDR)" });
  if (amount < 100 || amount > 10_000_000) return json(400, { error: "amount 100 - 10.000.000" });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SERVICE_ROLE_KEY")!);
  try {
    const inv = await createInvoice(
      supabase, amount, body.reference ?? null, body.callback_url ?? null,
      body.callback_secret ?? null, typeof body.expires_in === "number" ? body.expires_in : 900,
    );
    return json(201, inv);
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
