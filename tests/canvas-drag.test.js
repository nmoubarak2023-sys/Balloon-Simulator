import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { StudioView } from "../src/view.js";
// Real pointer/raycast/transform pipeline, with a DOM adapter instead of WebGL.
function setup(tool) {
  const labels = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!labels.has(id)) labels.set(id, { setAttribute() {} });
      return labels.get(id);
    },
    querySelectorAll() {
      return [];
    },
  };
  const v = Object.create(StudioView.prototype);
  v.tool = tool;
  v.editCurve = tool === "curve";
  v.selected = 0;
  v.selectedCurve = 0;
  v.ray = new T.Raycaster();
  v.pointer = new T.Vector2();
  v.span = 8;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {},
  };
  v.renderers = [{ domElement: canvas }, { domElement: canvas }];
  v.perspective = new T.PerspectiveCamera(45, 800 / 600, 0.1, 100);
  v.perspective.up.set(0, 0, 1);
  v.perspective.position.set(0, -10, 5);
  v.perspective.lookAt(0, 0, 0);
  v.perspective.updateMatrixWorld();
  v.plan = new T.OrthographicCamera(-4, 4, 3, -3, 0.1, 100);
  v.plan.position.set(0, 0, 10);
  v.plan.lookAt(0, 0, 0);
  v.plan.updateMatrixWorld();
  v.orbit = { enabled: true, autoRotate: false };
  v.proxy = new T.Object3D();
  v.transform = {
    enabled: true,
    dragging: false,
    axis: null,
    pointerHover() {
      this.axis = null;
    },
    detach() {
      this.object = null;
    },
    attach(o) {
      this.object = o;
    },
    setMode() {},
    setSpace() {},
  };
  v.meshes = [
    new T.Mesh(new T.SphereGeometry(1, 24, 16), new T.MeshStandardMaterial()),
  ];
  v.meshes[0].userData.index = 0;
  v.meshes[0].updateMatrixWorld();
  v.data = { centers: [[0, 0, 0]], edits: [[0, 0, 0, 1]] };
  v.box = { center: [0, 0, 0] };
  v.points = [
    [-1, 0, 0],
    [1, 0, 0],
  ];
  v.handles = v.points.map((p, i) => {
    const m = new T.Mesh(new T.SphereGeometry(0.15, 12, 8));
    m.position.set(...p);
    m.userData.index = i;
    m.updateMatrixWorld();
    return m;
  });
  v.onSelect = (i) => v.select(i);
  v.onCurve = (points, index) => {
    v.points = points;
    v.curveEvent = { points, index };
  };
  v.onTransform = (change) => (v.commit = change);
  v.attachTool();
  return v;
}
const event = (x, y) => ({
  clientX: x,
  clientY: y,
  button: 0,
  pointerId: 1,
  preventDefault() {},
  stopImmediatePropagation() {},
});
test("balloon drag selects, disables orbit, previews movement, then commits on release", () => {
  const old = globalThis.document;
  try {
    const v = setup("move");
    v.pointerDown(event(400, 300), 0);
    assert(v.directDrag);
    assert.equal(v.orbit.enabled, false);
    v.pointerMove(event(440, 300), 0);
    assert(v.meshes[0].matrix.elements[12] > 0.1);
    assert.equal(v.commit, undefined);
    v.pointerUp(event(440, 300), 0);
    assert.equal(v.commit.type, "balloon");
    assert.equal(v.commit.index, 0);
    assert(v.commit.delta[0] > 0.1);
    assert.equal(v.commit.ratio, 1);
    assert.equal(v.orbit.enabled, true);
  } finally {
    globalThis.document = old;
  }
});
test("plan curve drag moves the clicked point in XY and commits a pressure update", () => {
  const old = globalThis.document;
  try {
    const v = setup("curve");
    v.pointerDown(event(300, 300), 1);
    assert(v.directDrag);
    v.pointerMove(event(350, 250), 1);
    assert(Math.abs(v.curveEvent.points[0][0] + 0.5) < 1e-6);
    assert(Math.abs(v.curveEvent.points[0][1] - 0.5) < 1e-6);
    assert.equal(v.curveEvent.points[0][2], 0);
    v.pointerUp(event(350, 250), 1);
    assert.equal(v.commit.type, "curve");
    assert.equal(v.commit.index, 0);
    assert.equal(v.orbit.enabled, true);
  } finally {
    globalThis.document = old;
  }
});
test("curve Z-axis manipulation changes the selected point, not its neighbor", () => {
  const old = globalThis.document;
  try {
    const v = setup("curve");
    v.selectedCurve = 1;
    v.attachTool();
    v.beginTransform();
    v.proxy.position.z = 2;
    v.previewTransform();
    v.finishTransform();
    assert.equal(v.curveEvent.points[1][2], 2);
    assert.equal(v.curveEvent.points[0][2], 0);
    assert.equal(v.commit.type, "curve");
    assert.equal(v.commit.delta[2], 2);
  } finally {
    globalThis.document = old;
  }
});
test("Ctrl-click adds a selection once and does not start a drag", () => {
  const old = globalThis.document;
  try {
    const v = setup("move"),
      calls = [];
    v.onSelect = (i, add) => {
      calls.push([i, add]);
      v.select(i);
    };
    const e = { ...event(400, 300), ctrlKey: true };
    v.pointerDown(e, 0);
    v.pointerUp(e, 0);
    assert.deepEqual(calls, [[0, true]]);
    assert.equal(v.directDrag, undefined);
    assert.equal(v.commit, undefined);
  } finally {
    globalThis.document = old;
  }
});
test("clicking a frozen balloon selects it without a transform handle or drag", () => {
  const old = globalThis.document;
  try {
    const v = setup("move");
    v.data.meta = [{ id: "b0", members: [0], frozen: true }];
    v.attachTool();
    const e = event(400, 300);
    v.pointerDown(e, 0);
    v.pointerMove(event(440, 300), 0);
    v.pointerUp(event(440, 300), 0);
    assert.equal(v.selected, 0);
    assert.equal(v.transform.object, null);
    assert.equal(v.directDrag, undefined);
    assert.equal(v.commit, undefined);
  } finally {
    globalThis.document = old;
  }
});
