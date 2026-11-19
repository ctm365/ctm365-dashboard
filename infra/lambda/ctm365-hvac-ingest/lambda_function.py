import os, time, datetime, boto3
from decimal import Decimal

TABLE = boto3.resource("dynamodb").Table(os.environ.get("TABLE", "ctm365_hvac_telemetry"))
CT_AMPS = float(os.environ.get("CT_AMPS", "100"))
CURRENT_INT_SCALE = float(os.environ.get("CURRENT_INT_SCALE", "20000"))
POWER_SCALE = float(os.environ.get("POWER_SCALE", "10"))

def d(x, n=3):
    return Decimal(str(round(x, n)))

def adam_f(raw):
    c = raw * 200.0 / 65535.0 - 40.0
    return c * 1.8 + 32.0

def s16(v):
    v = int(v)
    return v - 65536 if v > 32767 else v

def convert(p):
    out = {}
    def has(k):
        return k in p and p[k] is not None
    # ADAM-4015 (0 = no response from module, 65535 = open or unplugged probe)
    if has("SupplyAir") and 0 < p["SupplyAir"] < 65535:
        out["air_supply_temp_f"] = d(adam_f(p["SupplyAir"]), 2)
        out["air_supply_raw"] = int(p["SupplyAir"])
    if has("ReturnAir") and 0 < p["ReturnAir"] < 65535:
        out["air_return_temp_f"] = d(adam_f(p["ReturnAir"]), 2)
        out["air_return_raw"] = int(p["ReturnAir"])
    # Strap-on refrigerant line probes and outdoor air, on spare ADAM-4015 channels
    # (Pt1000, -40 to 160 C). Raw 0 is no response; 65535 is an open or unplugged probe.
    for k, name in (("SuctionLine", "suction_line_temp_f"), ("DischargeLine", "discharge_line_temp_f"),
                    ("LiquidLine", "liquid_line_temp_f"), ("OutdoorAir", "outdoor_air_temp_f")):
        if has(k) and 0 < p[k] < 65535:
            out[name] = d(adam_f(p[k]), 2)
    # Belimo 22ADP-554, imperial: raw / 1000 = in. w.c.
    if has("Static"):
        inwc = s16(p["Static"]) / 1000.0
        out["static_pressure_inwc"] = d(inwc, 3)
        out["differential_pressure_pa"] = d(inwc * 249.089, 1)
    # WattNode integer registers
    if has("EnergyLo") and has("EnergyHi"):
        e = (int(p["EnergyHi"]) << 16) | int(p["EnergyLo"])
        if e >= 2**31:
            e -= 2**32
        out["energy_kwh"] = d(e * 0.1, 1)
    for k, name in (("Power", "power_w"), ("PowerA", "power_a_w"), ("PowerB", "power_b_w"), ("PowerC", "power_c_w")):
        if has(k):
            out[name] = d(s16(p[k]) * POWER_SCALE, 1)
    for k, name in (("VoltAvgLN", "voltage_avg_ln_v"), ("VoltAN", "voltage_an_v"), ("VoltBN", "voltage_bn_v"),
                    ("VoltCN", "voltage_cn_v"), ("VoltAvgLL", "voltage_v"), ("VoltAB", "voltage_ab_v"),
                    ("VoltBC", "voltage_bc_v"), ("VoltCA", "voltage_ca_v")):
        if has(k):
            out[name] = d(p[k] * 0.1, 1)
    if has("Freq"):
        out["frequency_hz"] = d(p["Freq"] * 0.1, 1)
    for k, name in (("PFAvg", "power_factor"), ("PFA", "power_factor_a"), ("PFB", "power_factor_b"), ("PFC", "power_factor_c")):
        if has(k):
            out[name] = d(s16(p[k]) * 0.01, 2)
    amps = []
    for k, name in (("AmpsA", "current_a_a"), ("AmpsB", "current_b_a"), ("AmpsC", "current_c_a")):
        if has(k):
            a = p[k] * CT_AMPS / CURRENT_INT_SCALE
            out[name] = d(a, 2)
            amps.append(a)
    if amps:
        out["current_a"] = d(max(amps), 2)
    if has("PowerScale"):
        out["power_scale_reported"] = int(p["PowerScale"])
    return out

def minute_key(ms):
    return datetime.datetime.fromtimestamp(ms // 60000 * 60, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:00Z")

def lambda_handler(event, context):
    unit = event.get("unit_id") or "unknown"
    site = event.get("site_id") or "unknown"
    ms = int(event.get("received_ms") or time.time() * 1000)
    fields = convert(event.get("properties") or {})
    if not fields:
        return {"skipped": True}
    key = minute_key(ms)
    # A reading cycle arrives as several messages within a few seconds.
    # If this message lands just after a minute boundary and the previous
    # minute's item was updated moments ago, keep the cycle together.
    if (ms // 1000) % 60 < 15:
        prev = minute_key(ms - 60000)
        r = TABLE.get_item(Key={"hvac_unit_id": unit, "timestamp": prev},
                           ProjectionExpression="last_update_ms").get("Item")
        if r and ms - int(r.get("last_update_ms", 0)) < 15000:
            key = prev
    fields["site_id"] = site
    fields["last_update_ms"] = ms
    names = {}
    values = {}
    sets = []
    for i, (k, v) in enumerate(fields.items()):
        names["#k%d" % i] = k
        values[":v%d" % i] = v
        sets.append("#k%d = :v%d" % (i, i))
    TABLE.update_item(Key={"hvac_unit_id": unit, "timestamp": key},
                      UpdateExpression="SET " + ", ".join(sets),
                      ExpressionAttributeNames=names, ExpressionAttributeValues=values)
    return {"key": key, "fields": len(fields)}
