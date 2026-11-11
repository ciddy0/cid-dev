// Checks the committed public/data/metro.json holds what the page counts on.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { lineParts } from "../public/js/network.js";

const map = JSON.parse(await readFile(new URL("../public/data/metro.json", import.meta.url), "utf8"));

test("every line is drawable and rideable", () => {
  assert.ok(map.layout.lane > 0);
  assert.ok(map.lines.length > 0);
  for (const line of map.lines) {
    assert.match(line.color, /^#[0-9A-F]{6}$/i, line.id);
    assert.ok(line.trainsPerHour > 0, line.id);
    assert.equal(line.times.length, line.stations.length, line.id);
    assert.deepEqual(line.times, line.times.toSorted((a, b) => a - b), line.id);
    for (const part of lineParts(line)) {
      assert.ok(part.path.length >= 2, line.id);
      assert.equal(part.stops.length, part.stations.length, line.id);
      assert.equal(part.at.length, part.stations.length, line.id);
      assert.deepEqual(part.at, part.at.toSorted((a, b) => a - b), line.id);
      for (const id of part.stations) assert.ok(map.stations[id]?.lines.includes(line.id), `${line.id} ${id}`);
    }
    for (const extra of line.extraPaths)
      for (const end of [extra.stations[0], extra.stations.at(-1)])
        assert.ok(line.stations.includes(end), `${line.id} extra path ends on the line`);
  }
});

test("every station is on a line", () => {
  const known = new Set(map.lines.map((l) => l.id));
  for (const [id, s] of Object.entries(map.stations)) {
    assert.ok(s.name && Number.isFinite(s.x) && Number.isFinite(s.y), id);
    assert.ok(s.lines.length > 0 && s.lines.every((l) => known.has(l)), id);
    assert.equal(s.transfer, s.lines.length > 1, id);
  }
});
