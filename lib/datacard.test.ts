import assert from "node:assert/strict";
import { test } from "node:test";
import { samplesToReadings, toSample } from "./datacard.ts";

test("toSample converts SensorN raw values to Celsius rise (x 0.1)", () => {
  const s = toSample({ timestamp: "1795071029588", properties: { Sensor1: 123, Sensor2: "45", Sensor8: 0 } });
  assert.deepEqual(s, { ts: 1795071029588, channels: { 1: 12.3, 2: 4.5, 8: 0 } });
});

test("toSample skips channels that are missing or not numbers, and rejects a bad timestamp", () => {
  assert.deepEqual(toSample({ timestamp: "1", properties: { Sensor1: "n/a", Sensor3: null } })?.channels, {});
  assert.deepEqual(toSample({ timestamp: "1" })?.channels, {});
  assert.equal(toSample({ timestamp: "soon", properties: { Sensor1: 1 } }), null);
});

test("samplesToReadings maps each sensor to its channel and skips channels with no value", () => {
  const samples = [
    { ts: 1000, channels: { 1: 2.5, 3: 9 } },
    { ts: 2000, channels: { 1: 2.6 } },
  ];
  const sensors = [
    { id: "a", channel: 1 },
    { id: "b", channel: 3 },
    { id: "c", channel: 5 },
  ];
  assert.deepEqual(samplesToReadings(samples, sensors), [
    { sensorId: "a", ts: 1000, deltaC: 2.5 },
    { sensorId: "b", ts: 1000, deltaC: 9 },
    { sensorId: "a", ts: 2000, deltaC: 2.6 },
  ]);
});
