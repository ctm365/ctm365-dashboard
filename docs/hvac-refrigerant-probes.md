# Refrigerant-side monitoring with strap-on probes

The refrigerant analysis works without opening the refrigerant circuit. It reads
**suction and discharge line surface temperatures**, **compressor power** (from the
WattNode) and **outdoor air temperature**. For each unit, it learns how those normally move
with the weather, then flags patterns that match low charge, overcharge, low indoor airflow
and condenser problems. It also tracks slow charge loss over weeks. Thalo Labs' Sidekick works
the same way.

It is an inference, not a gauge reading. A finding says "pattern consistent with", and a tech
confirms it with gauges.

## Parts (per unit)

| Probe | ADAM-4015 channel | Gateway point name | Notes |
|---|---|---|---|
| Suction line | 2 | `SuctionLine` | Pt1000, 3-wire, pipe-clamp style |
| Discharge line | 3 | `DischargeLine` | Pt1000, 3-wire, rated to at least 300°F (the line runs 150-250°F) |
| Outdoor air | 4 | `OutdoorAir` | Pt1000 in a small radiation shield, or any shaded outdoor probe |
| Liquid line (optional) | 5 | `LiquidLine` | Pt1000, 3-wire; recorded now, used later for subcooling estimates |

Also: thermal paste, stainless hose clamps or the probe's clamp, and closed-cell pipe
insulation (high-temperature rated for the discharge line).

## Placement

1. **Suction line.** Mount on the larger, insulated vapor line, within about **6 inches of
   the compressor's suction port**. Use clean bare copper, thermal paste and a tight clamp,
   then insulate over the probe so outdoor air doesn't skew it.
2. **Discharge line.** Mount within about **6 inches of the compressor's discharge port**.
   Keep it away from the crankcase heater and any brazed joints. Insulate over the probe with
   high-temperature insulation.
3. **Heat pumps (like the Bard W42HC).** Mount both probes **at the compressor**, not at the
   service valves. The lines at the compressor stay suction and discharge in both heating and
   cooling, whereas the lines between the reversing valve and the coils swap roles.
4. **Outdoor air.** Mount in the shade, out of the condenser's discharge airflow, and away
   from walls that heat up in the sun. A north-facing spot on the unit's intake side is ideal.
5. **Liquid line (optional).** Mount on the small line between the condenser and the
   metering device.

Probes touch only the outside of the copper lines. Nothing opens the refrigerant circuit.

## ADAM-4015 setup (Adam/Apax .NET Utility)

- Set channels 2-5 to **Pt1000, -40 to 160°C** (the same range as channels 0 and 1). 160°C is
  320°F, which covers the discharge line.
- Enable only the channels that have a probe connected. A disabled or unplugged channel reads
  as open (raw 65535). The ingest step ignores that value instead of recording 320°F.
- Wait about 7 seconds after each change, because the module recalibrates.

## Gateway setup (SST-MQT-CFG)

On the ADAM poll (slave 2, start register 0), change the **count from 2 to 5** (or 6 if the
liquid-line probe is fitted). Name the new points exactly:

`SupplyAir`, `ReturnAir`, `SuctionLine`, `DischargeLine`, `OutdoorAir` (and `LiquidLine`)

Keep the same topic (`ctm365/<site>/hvac/<unit>`). The ingest step already understands the new
names, so no AWS changes are needed.

## After install

1. On the customer's admin page, use **Start learning again** for the unit, so its normal
   behavior is learned with the probes in place. (This button is still being built.)
2. The refrigerant model needs about **2 weeks of normal running** (at least 300 settled
   running minutes per mode). It gets sharper when that period includes a range of outdoor
   temperatures.
3. These checks work immediately, with no learning period:
   - discharge line over 225°F is Elevated, and over 250°F is Action;
   - suction line at or below 32°F for 30+ minutes while cooling means the coil is freezing;
   - discharge only slightly warmer than suction while running means the compressor isn't
     pumping.

## What it detects

| Pattern (vs this unit's normal for the same weather) | Finding |
|---|---|
| Suction warmer, discharge hotter, less kW, less ΔT | Low charge or leak (compressor valve wear looks similar) |
| The low-charge pattern growing slowly for 10+ days | Charge drifting down (slow leak) |
| Suction colder, more kW | Overcharge or a stuck-open metering device |
| Suction colder, bigger ΔT, less kW | Low indoor airflow (filter, coil, blower) |
| Discharge hotter, more kW | Condenser problem (dirty coil, fan, fan capacitor) |
| More kWh than the outdoor temperature explains | Efficiency loss (weather-adjusted, using cooling degree-days) |

These patterns are judged in **cooling mode**. In heating mode, only the absolute limits and the
power and capacity checks apply.

Strength levels are calibrated so that roughly **15% charge loss is a Watch, 20% Elevated,
and 30% or more an Action**. Real units vary, and these levels should be tuned against
gauge readings as service data comes in.
