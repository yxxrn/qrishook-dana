#!/usr/bin/env python3
"""QRIS static -> dynamic. Port of verssache/qris-dinamis (MIT, Gidhan).
- Point of Initiation Method (tag 01): 11 (static) -> 12 (dynamic)
- Inject Transaction Amount (tag 54) before Country Code (tag 58)
- Recalculate CRC16-CCITT (poly 0x1021, init 0xFFFF) over payload + "6304"
"""

# Static QRIS milik yxrn store (DANA) - decoded dari flyer QRIS
STATIC_PAYLOAD = (
    "00020101021126570011ID.DANA.WWW011893600915334163417002093416341700303UMI"
    "51440014ID.CO.QRIS.WWW0215ID10222210473120303UMI5204481453033605802ID"
    "5910yxrn store6014Kab. Mojokerto6105613816304C453"
)


def crc16(s: str) -> str:
    crc = 0xFFFF
    for ch in s:
        crc ^= ord(ch) << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return format(crc & 0xFFFF, "04X")


def parse_top_level(s: str) -> list[tuple[str, str]]:
    """Parse QRIS menjadi list (tag, value) level atas. Value tetap string mentah."""
    out = []
    i = 0
    while i + 4 <= len(s):
        tag = s[i:i + 2]
        length = int(s[i + 2:i + 4])
        value = s[i + 4:i + 4 + length]
        out.append((tag, value))
        i += 4 + length
    if i != len(s):
        raise ValueError(f"trailing data di offset {i}")
    return out


def convert(amount: int, payload: str = STATIC_PAYLOAD) -> str:
    if not (isinstance(amount, int) and amount > 0):
        raise ValueError("amount harus integer positif (IDR)")
    elements = parse_top_level(payload)
    result = []
    amount_inserted = False
    for tag, value in elements:
        if tag in ("54", "55", "56", "57", "63"):
            continue  # dikelola ulang
        if tag == "01":
            result.append(("01", "12"))
            continue
        if tag == "58" and not amount_inserted:
            amount_str = str(amount)
            result.append(("54", amount_str))
            amount_inserted = True
        result.append((tag, value))
    if not amount_inserted:
        raise ValueError("tag 58 (Country Code) tidak ditemukan")
    rebuilt = "".join(f"{t}{len(v):02d}{v}" for t, v in result)
    return rebuilt + "6304" + crc16(rebuilt + "6304")


if __name__ == "__main__":
    import sys
    print(convert(int(sys.argv[1]) if len(sys.argv) > 1 else 15000))