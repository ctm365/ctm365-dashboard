# Bringing the gateways back online

Everything in AWS and on dashboard.ctm365.com is already in place: the IoT rules,
ingest, alerts, the 90-minute health job and the dashboard. As soon as a gateway
publishes, readings flow through on their own. Nothing needs changing in AWS.

## HVAC gateway (GT-200, MQTT client `ctm365-gt200-mqie-hvac-01`)

1. **Load the config.**
   - Without the new probes: keep `MobMod Gateway Config - mode2.json`.
   - With the new probes: load `MobMod Gateway Config - mode2 - probes.json`
     (in `OneDrive\Desktop\HVAC Hardware`). It is identical except for one added
     poll: ADAM address 2, registers 2-5, gateway memory 0x0040, points
     `SuctionLine`, `DischargeLine`, `OutdoorAir`, `LiquidLine`.
   - The topic stays `ctm365/MobModBeta/hvac/bard-01`. For a new site or unit, change
     every Topic Name to `ctm365/<site>/hvac/<unit-id>` and add the unit on the
     customer's admin page with the same unit ID.
2. **Set up the ADAM-4015 (Adam/Apax .NET Utility).**
   - Set channels 2-5 to Pt1000, -40 to 160°C.
   - Jumper the third terminal on any 2-wire probe.
   - A channel with no probe reads as open (raw 65535). The ingest ignores that
     reading, so a missing liquid-line probe is fine.
3. **Check the supply and return air probes (channels 0-1).** On Nov 19 they read
   320°F, which is an open circuit. Re-seat the wiring or add the 2-wire jumpers.
4. **Power up, then check within about 2 minutes.**
   - The HVAC tab shows the unit as Online with a fresh reading time.
   - New tiles appear for each probe: Suction line, Discharge line, Compressor lift,
     Liquid line and Outdoor air.
5. **On the real Bard (not the bench):** on the customer's admin page, press
   **Start learning again** for the unit, so its normal is learned from the real
   install. (`bard-01` is already set to learn only from Nov 20 on, which skips the
   Nov 19 bench test.)

What happens next, with no action needed:

- **Right away:** cycle analysis, power-problem shutdowns, and voltage, imbalance
  and static-pressure limits run. So do the refrigerant hard limits (discharge
  225/250°F, freezing coil, no compression).
- **After about 3 hours of compressor running with probes:** the refrigerant
  comparison against normal starts, at low confidence.
- **After the first full day:** comparisons with the unit's own normal start. They
  keep learning every day, and confidence rises from low to medium (3 days) to
  high (7 days).
- **Health:** recalculates every 90 minutes ("Checked" time on the health panel).

## Electrical gateway (MQTT client `ctm365-gt200-mqie-electrical-01`)

1. **Choose a topic.**
   - **Recommended:** `ctm365/<site>/electrical/<datacard-id>`, for example
     `ctm365/MobModBeta/electrical/exertherm-07`. Then enter that datacard ID on
     the customer's admin page, under Electrical > Datacard.
   - **Old topic:** `ctm365/acme-corp/plant-01/gt200-0042/temperature` still works.
     It is stored as datacard `exertherm-07`.
2. **Name the Exertherm points** `Sensor1` to `Sensor8`. A reading of N means
   N x 0.1°C of rise. Each sensor's channel on the admin page picks one of these.
3. **Panel voltage and current (optional).** The WattNode on the electrical gateway
   publishes to `ctm365/<site>/power/<meter-id>`. It uses the same point names as
   the HVAC WattNode poll. Enter the meter ID on the admin page and switch on
   Show voltage / Show current.
4. **Turn off "Show sample data"** for any customer that should show live readings.
   `demo` currently has it on.
5. **Certificate.** The electrical gateway connects with client ID
   `ctm365-gt200-mqie-electrical-01`, using a certificate attached to
   `CTM365ElectricalGatewayPolicy`. If this is a new GT-200 that doesn't have that
   certificate yet, it has to be created first.
6. **Alerts.** A sensor at or above its customer's Critical limit for 2 readings in
   a row emails info@ctm365.com once, from alerts@ctm365.com. Sample-data customers
   never alert.

## If nothing shows up

- **Unit still Offline after 5 minutes:** check the gateway's cellular signal and
  that the topic matches exactly (including capitals). A topic the gateway isn't
  allowed to publish to makes it drop the connection.
- **Readings arrive but a value is missing:** that device didn't answer. Check its
  Modbus address and bus wiring.
- **320°F, or a probe missing from the tiles:** open or unplugged probe. Check the
  wiring and the ADAM channel type.
