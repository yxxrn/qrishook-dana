import { convert, crc16 } from "./qris.ts";

// Vektor hasil cross-check dengan implementasi TS asli (verssache/qris-dinamis)
let failed = 0;

function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`ok - ${name}`);
  } else {
    failed++;
    console.error(`FAIL - ${name}`);
  }
}

const out = convert(15000);
check("point of initiation -> dynamic", out.includes("010212") && !out.includes("010211"));
check("CRC 15000 = 8BA1", convert(15000).endsWith("63048BA1"));
check("CRC 15037 = 7B65", convert(15037).endsWith("63047B65"));
check("CRC 100 = 6057", convert(100).endsWith("63046057"));
check("tag 54 injected", convert(15059).includes("540515059"));
check("crc16 known vector", crc16("000201010212") === "342A");

if (failed > 0) {
  console.error(`${failed} test gagal`);
  Deno.exit(1);
}
console.log("semua test lolos");
