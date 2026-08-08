import { json } from "../_shared/http.ts";

// Butuh header X-Webhook-Secret — dipanggil cron-job.org (custom header) anti-pause
Deno.serve((req) => {
  if (req.headers.get("X-Webhook-Secret") !== Deno.env.get("QRIS_HOOK_SECRET")) {
    return json(401, { error: "bad secret" });
  }
  return json(200, { ok: true });
});
