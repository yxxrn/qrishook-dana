// QRIS static -> dynamic (port dari verssache/qris-dinamis, MIT)
export const STATIC_PAYLOAD =
  "00020101021126570011ID.DANA.WWW011893600915334163417002093416341700303UMI" +
  "51440014ID.CO.QRIS.WWW0215ID10222210473120303UMI5204481453033605802ID" +
  "5910yxrn store6014Kab. Mojokerto6105613816304C453";

export function crc16(s: string): string {
  let crc = 0xffff;
  for (let i = 0; i < s.length; i++) {
    crc ^= s.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return (crc & 0xffff).toString(16).toUpperCase().padStart(4, "0");
}

export function convert(amount: number, payload: string = STATIC_PAYLOAD): string {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("amount must be positive int");
  const els: [string, string][] = [];
  let i = 0;
  while (i + 4 <= payload.length) {
    const tag = payload.slice(i, i + 2);
    const len = parseInt(payload.slice(i + 2, i + 4), 10);
    els.push([tag, payload.slice(i + 4, i + 4 + len)]);
    i += 4 + len;
  }
  const out: [string, string][] = [];
  let inserted = false;
  for (const [tag, value] of els) {
    if (["54", "55", "56", "57", "63"].includes(tag)) continue;
    if (tag === "01") {
      out.push(["01", "12"]);
      continue;
    }
    if (tag === "58" && !inserted) {
      out.push(["54", String(amount)]);
      inserted = true;
    }
    out.push([tag, value]);
  }
  if (!inserted) throw new Error("tag 58 not found");
  const rebuilt = out.map(([t, v]) => `${t}${String(v.length).padStart(2, "0")}${v}`).join("");
  return rebuilt + "6304" + crc16(rebuilt + "6304");
}
