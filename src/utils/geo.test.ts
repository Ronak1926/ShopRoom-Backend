import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundingBox, haversineKm, isValidCoordinate } from "./geo.js";

const MUMBAI = { latitude: 19.076, longitude: 72.8777 };
const PUNE = { latitude: 18.5204, longitude: 73.8567 };

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    assert.equal(haversineKm(MUMBAI, MUMBAI), 0);
  });

  it("matches the known Mumbai-Pune great-circle distance (~120 km)", () => {
    const d = haversineKm(MUMBAI, PUNE);
    assert.ok(d > 115 && d < 125, `got ${d}`);
  });

  it("is symmetric", () => {
    assert.equal(haversineKm(MUMBAI, PUNE), haversineKm(PUNE, MUMBAI));
  });

  it("does not throw for antipodal points", () => {
    const d = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 });
    assert.ok(Math.abs(d - 20015) < 5, `got ${d}`);
  });
});

describe("boundingBox", () => {
  it("always contains every point inside the radius", () => {
    const radiusKm = 10;
    const box = boundingBox(MUMBAI, radiusKm);
    // Sample points on the circle edge in 8 directions.
    for (let bearing = 0; bearing < 360; bearing += 45) {
      const rad = (bearing * Math.PI) / 180;
      const point = {
        latitude: MUMBAI.latitude + ((radiusKm * 0.999) / 111.19) * Math.cos(rad),
        longitude:
          MUMBAI.longitude +
          ((radiusKm * 0.999) / (111.19 * Math.cos((MUMBAI.latitude * Math.PI) / 180))) *
            Math.sin(rad),
      };
      assert.ok(haversineKm(MUMBAI, point) <= radiusKm);
      assert.ok(point.latitude >= box.minLat && point.latitude <= box.maxLat);
      assert.ok(box.minLng !== null && box.maxLng !== null);
      assert.ok(point.longitude >= box.minLng! && point.longitude <= box.maxLng!);
    }
  });

  it("drops the longitude bounds when the box wraps the antimeridian", () => {
    const box = boundingBox({ latitude: 0, longitude: 179.99 }, 25);
    assert.equal(box.minLng, null);
    assert.equal(box.maxLng, null);
  });

  it("drops the longitude bounds at the poles", () => {
    const box = boundingBox({ latitude: 89.9, longitude: 10 }, 25);
    assert.equal(box.minLng, null);
  });
});

describe("isValidCoordinate", () => {
  it("accepts in-range finite numbers", () => {
    assert.equal(isValidCoordinate(19.07, 72.87), true);
    assert.equal(isValidCoordinate(-90, 180), true);
  });

  it("rejects out-of-range, non-finite and non-number input", () => {
    assert.equal(isValidCoordinate(91, 0), false);
    assert.equal(isValidCoordinate(0, -181), false);
    assert.equal(isValidCoordinate(Number.NaN, 0), false);
    assert.equal(isValidCoordinate("19", 72), false);
    assert.equal(isValidCoordinate(null, null), false);
  });
});
