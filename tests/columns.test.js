import test from "node:test";
import assert from "node:assert/strict";
import Module from "manifold-3d";
import { voronoiBuild } from "../src/voronoi-engine.js";
import { collisionSites, columnMesh, roofSampler } from "../src/columns.js";
import { meshQuality, signedVolume } from "../src/mesh-quality.js";
const m = await Module();
m.setup();
const params = {
  width: 80,
  height: 50,
  count: 40,
  seed: 42,
  index: 0,
  selected: 17,
  radiusMin: 15,
  radiusMax: 25,
  radiusSeed: 17,
  floor: 0,
  spacing: 2,
  smoothing: 4,
};
const result = voronoiBuild(m, params);
test("collision sites use overlapping edited roof owners and remain inside the actual footprint", () => {
  const sites = collisionSites(result),
    sample = roofSampler(result.raw);
  assert.ok(sites.length > 0);
  assert.deepEqual(collisionSites(result), sites);
  for (const s of sites) {
    assert.ok(s.balloons.length >= 2);
    assert.ok(s.balloons.every((i) => result.ids.includes(i)));
    assert.ok(Math.abs(sample(s.x, s.y) - s.z) < 1e-6);
  }
  assert.ok(sites.some((s) => s.kind === "junction"));
});
test("flared supports are closed positive-volume shells and meet the actual roof", () => {
  const before = Array.from(result.raw.positions),
    sites = collisionSites(result);
  let built = 0;
  for (const site of sites) {
    let raw;
    try {
      raw = columnMesh(result, site, { radius: 0.5, flare: 3, blend: 0.55 });
    } catch {
      continue;
    }
    const q = meshQuality(raw);
    assert.equal(q.boundaryEdges, 0);
    assert.equal(q.nonManifoldEdges, 0);
    assert.equal(q.degenerateFaces, 0);
    assert.equal(q.inconsistentEdges, 0);
    assert.ok(signedVolume(raw) > 0);
    const solid = new m.Manifold(
      new m.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(raw.positions),
        triVerts: raw.indices,
      }),
    );
    assert.equal(solid.status(), "NoError");
    solid.delete();
    const sample = roofSampler(result.raw);
    for (let i = 32 * 64; i < 33 * 64; i++) {
      const [x, y, z] = raw.positions.slice(i * 3, i * 3 + 3);
      assert.ok(Math.abs(z - sample(x, y)) < 1e-6);
    }
    built++;
    if (built >= 4) break;
  }
  assert.ok(built >= 2);
  assert.deepEqual(Array.from(result.raw.positions), before);
});
test("no false collisions for a single balloon; reject invalid support settings", () => {
  const one = voronoiBuild(m, { ...params, selected: 1 });
  assert.equal(collisionSites(one).length, 0);
  const site = collisionSites(result)[0];
  assert.throws(() =>
    columnMesh(result, site, { radius: 2, flare: 1, blend: 0.5 }),
  );
  assert.throws(() =>
    columnMesh(result, site, { radius: 1, flare: 3, blend: 1 }),
  );
});
