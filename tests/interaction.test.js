import test from "node:test";
import assert from "node:assert/strict";
import { Matrix4, Quaternion, Vector3 } from "three";
import Module from "manifold-3d";
import {
  transformMesh,
  draggedEdit,
  uniformFactor,
} from "../src/interaction.js";
import { BalloonEngine, topology } from "../src/engine.js";
test("rotation changes imported mesh coordinates about its center and preserves closed volume", async () => {
  const m = await Module();
  m.setup();
  const e = new BalloonEngine(m),
    box = m.Manifold.cube([120, 90, 65], true).translate([20, 30, 40]),
    raw = e.raw(box),
    center = new Vector3(20, 30, 40),
    matrix = new Matrix4()
      .compose(
        center,
        new Quaternion().setFromAxisAngle(
          new Vector3(1, 1, 0).normalize(),
          0.6,
        ),
        new Vector3(1, 1, 1),
      )
      .multiply(new Matrix4().makeTranslation(-20, -30, -40)),
    rotated = transformMesh(raw, matrix.toArray()),
    solid = e.toSolid(rotated);
  assert.notDeepEqual(raw.positions, rotated.positions);
  assert.deepEqual(topology(rotated), {
    valid: true,
    closed: true,
    manifold: true,
  });
  assert(Math.abs(solid.volume() - box.volume()) < box.volume() * 1e-6);
  e.generate(
    rotated,
    {
      count: 6,
      pointSeed: 42,
      radiusSeed: 17,
      radiusMin: 14,
      radiusMax: 24,
      quality: 48,
      clearance: 0.12,
      pressureEnabled: false,
    },
    [],
  );
  for (let i = 0; i < 6; i++) assert(e.safe(i, e.balloons[i]));
  box.delete();
  solid.delete();
  e.clear();
});
test("successive canvas drags use accepted offsets and uniform scaling", () => {
  assert.deepEqual(
    draggedEdit([4, -2, 1, 0.8], [2, 3, -4], 1.5),
    [6, 1, -3, 1.2000000000000002],
  );
  assert.equal(uniformFactor([1, 1.5, 1]), 1.5);
  assert.equal(uniformFactor([0.7, 1, 1]), 0.7);
  assert.equal(draggedEdit([0, 0, 0, 2], [0, 0, 0], 5)[3], 3);
  assert.throws(() => draggedEdit([0, 0, 0, 1], [NaN, 0, 0]), /Invalid/);
});
