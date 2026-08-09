// Callback dengan retry (backoff 1m/5m/30m/2h/12h, max 5 percobaan)
// Dipakai hook (delivery pertama) & expiry (retry sweep tiap menit).

export function backoffSeconds(attempt: number): number {
  const table = [60, 300, 1800, 7200, 43200];
  return table[Math.min(Math.max(attempt, 1), table.length) - 1];
}

export async function deliverCallback(supabase: any, row: any): Promise<boolean> {
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (row.secret) headers["X-Callback-Secret"] = row.secret;
    const res = await fetch(row.url, {
      method: "POST", headers, body: JSON.stringify(row.payload), signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return false;
    await supabase.from("callback_queue").delete().eq("id", row.id);
    return true;
  } catch {
    return false;
  }
}

export async function retryCallbacks(supabase: any): Promise<number> {
  const now = new Date().toISOString();
  // dua query terpisah (hindari .or() yang tidak encode '+' pada ISO timestamp)
  const { data: dueNull } = await supabase
    .from("callback_queue").select("*").lt("attempts", 5).is("next_retry_at", null).limit(10);
  const { data: dueNow } = await supabase
    .from("callback_queue").select("*").lt("attempts", 5).lte("next_retry_at", now).limit(10);
  const rows = [...(dueNull ?? []), ...(dueNow ?? [])];
  let delivered = 0;
  for (const row of rows ?? []) {
    if (await deliverCallback(supabase, row)) {
      delivered++;
    } else {
      const attempts = Number(row.attempts) + 1;
      await supabase.from("callback_queue")
        .update({ attempts, next_retry_at: new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString() })
        .eq("id", row.id);
    }
  }
  return delivered;
}
