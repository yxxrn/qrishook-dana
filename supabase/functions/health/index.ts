import { json } from "../_shared/http.ts";

Deno.serve(() => json(200, { ok: true }));
