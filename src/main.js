import "./style.css";
import * as T from "three";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { StudioView, geometry, rawGeometry } from "./view.js";
import { bounds, canonical } from "./engine.js";
import { rhinoRaw, addRhinoMesh } from "./rhino-io.js";
import { transformMesh, draggedEdit } from "./interaction.js";
const $ = (id) => document.getElementById(id),
  paramsIDs = [
    "count",
    "pointSeed",
    "radiusMin",
    "radiusMax",
    "radiusSeed",
    "quality",
    "clearance",
    "strength",
    "influence",
    "tolerance",
  ];
let needsRestore = false;
let boundary,
  display,
  output = null,
  points = [],
  selected = 0,
  editCurve = false,
  busy = false,
  worker,
  seq = 0,
  pending = new Map(),
  rhinoPromise,
  configUsed,
  curveUsed,
  meshChoices = [],
  fileName = "Demonstration container";
function status(message, error = false) {
  $("status").textContent = message;
  $("status").parentElement.classList.toggle("error", error);
}
function newWorker() {
  worker = new Worker(new URL("./worker.js", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (data.progress !== undefined) {
      $("progress").value = data.progress;
      status(data.text);
      return;
    }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
  };
  worker.onerror = (e) => {
    for (const p of pending.values())
      p.reject(Error(e.message || "Geometry worker failed."));
    pending.clear();
  };
}
function request(action, data = {}) {
  if (needsRestore && ["edit", "output"].includes(action)) {
    if (!display || !configUsed)
      return Promise.reject(Error("Generate balloons first."));
    return request("restore", {
      boundary: display.boundary,
      params: configUsed,
      curve: curveUsed,
      edits: display.edits,
    }).then(() => {
      needsRestore = false;
      return request(action, data);
    });
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, ...data });
  });
}
async function task(message, fn) {
  if (busy) return;
  busy = true;
  view.setBusy(true);
  $("progress").hidden = false;
  $("cancelBtn").hidden = false;
  $("progress").value = 0;
  document
    .querySelectorAll(
      ".controls button,.controls input,.controls select,.canvas-tools button,#curveEditBtn",
    )
    .forEach((e) => (e.disabled = true));
  status(message);
  try {
    await fn();
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
    view.setBusy(false);
    $("progress").hidden = true;
    $("cancelBtn").hidden = true;
    document
      .querySelectorAll(
        ".controls button,.controls input,.controls select,.canvas-tools button,#curveEditBtn",
      )
      .forEach((e) => (e.disabled = false));
  }
}
function params() {
  const p = Object.fromEntries(
    paramsIDs.map((id) => [id, Number($(id).value)]),
  );
  p.pressureEnabled = $("pressureEnabled").checked;
  if (
    Object.values(p).some((v) => typeof v === "number" && !Number.isFinite(v))
  )
    throw Error("Enter finite numeric settings.");
  if (!Number.isInteger(p.count) || p.count < 1 || p.count > 40)
    throw Error("Count must be an integer from 1 to 40.");
  for (const k of ["pointSeed", "radiusSeed"])
    if (!Number.isInteger(p[k]) || p[k] < 0 || p[k] > 2147483647)
      throw Error("Seeds must be integers from 0 to 2147483647.");
  if (p.radiusMin <= 0 || p.radiusMax < p.radiusMin)
    throw Error("Radius maximum must be at least the positive radius minimum.");
  if (
    p.clearance <= 0 ||
    p.strength < 0 ||
    p.influence <= 0 ||
    p.tolerance <= 0
  )
    throw Error(
      "Gap, influence distance, and tolerance must be positive; pressure must be nonnegative.",
    );
  return p;
}
function invalidate() {
  output = null;
  if (view.field.children.length) view.output(null);
  $("outputStatus").textContent =
    "Output needs rebuilding after geometry changes. Separate input shells remain available.";
}
function syncDisplay(result, fit = false) {
  display = result;
  boundary = result.boundary;
  invalidate();
  view.show(result, fit);
  $("balloonSelect").replaceChildren(
    ...result.balloons.map(
      (_, i) => new Option(`BALLOON ${String(i + 1).padStart(2, "0")}`, i),
    ),
  );
  select(Math.min(selected, result.balloons.length - 1));
  const triangles = result.balloons.reduce(
    (n, b) => n + b.indices.length / 3,
    0,
  );
  $("meshStats").textContent =
    `${result.balloons.length} BALLOONS / ${triangles.toLocaleString()} TRIANGLES`;
  $("fieldLabel").textContent = fileName.toUpperCase();
  view.curve(points, editCurve, $("pressureEnabled").checked || editCurve);
}
function select(i) {
  selected = Math.max(0, Number(i));
  $("balloonSelect").value = selected;
  view.select(selected);
  const e = display?.edits[selected] || [0, 0, 0, 1];
  ["moveX", "moveY", "moveZ", "scale"].forEach(
    (id, k) => ($(id).value = Number(e[k].toFixed(5))),
  );
}
const view = new StudioView(
  (i) => {
    if (!busy) {
      if (view.tool === "curve") activateTool("move");
      select(i);
    }
  },
  (p, i) => {
    if (busy) return;
    points = p;
    view.curve(points, editCurve, true);
    $("curvePoint").value = i;
    showPoint();
    markCurveDirty();
  },
  onCanvasTransform,
);
function activateTool(tool) {
  if (busy) return;
  if (output?.mode === "boolean") invalidate();
  if (tool === "boundary") $("showBoundary").checked = true;
  editCurve = tool === "curve";
  if (editCurve) $("pressureEnabled").checked = true;
  $("curveEditBtn").setAttribute("aria-pressed", editCurve);
  view.setTool(tool);
  curveUI();
}
document
  .querySelectorAll("[data-canvas-tool]")
  .forEach(
    (button) =>
      (button.onclick = () => activateTool(button.dataset.canvasTool)),
  );
function onCanvasTransform(change) {
  if (change.type === "cancel") {
    if (display) syncDisplay(display);
    return;
  }
  if (busy) return;
  const label =
    change.type === "boundary"
      ? "Rotating boundary and regenerating balloon field…"
      : change.type === "curve"
        ? "Updating curve pressure…"
        : "Checking dragged balloon against walls and neighbors…";
  task(label, async () => {
    try {
      if (change.type === "boundary") {
        boundary = transformMesh(display.boundary, change.matrix);
        await generate(true);
        status(
          "Boundary rotated. Balloon field regenerated in its new orientation; individual edits reset.",
        );
      } else if (change.type === "curve") {
        if ($("pressureEnabled").checked) {
          await generate();
          status(
            "Curve point moved. Pressure applied; individual edits reset.",
          );
        } else
          status("Curve point moved. Enable pressure to deform the balloons.");
      } else if (change.type === "balloon") {
        const edit = draggedEdit(
          display.edits[change.index],
          change.delta,
          change.ratio,
        );
        const result = await request("edit", { index: change.index, edit });
        syncDisplay(result);
        status(
          result.clamped
            ? "Drag limited by a wall or neighboring balloon. Accepted position and scale are shown."
            : "Canvas edit applied. Balloon remains inside the boundary without overlap.",
        );
      }
    } catch (err) {
      boundary = display.boundary;
      syncDisplay(display);
      throw err;
    }
  });
}
function resetCurve() {
  const b = bounds(boundary);
  points = [
    [-0.45, -0.2],
    [-0.15, 0.25],
    [0.15, -0.15],
    [0.45, 0.2],
  ].map(([x, y]) => [
    b.center[0] + x * b.span[0],
    b.center[1] + y * b.span[1],
    b.center[2],
  ]);
  curveUI();
}
function curveUI() {
  const last = Number($("curvePoint").value) || 0;
  $("curvePoint").replaceChildren(
    ...points.map((_, i) => new Option(`POINT ${i + 1}`, i)),
  );
  $("curvePoint").value = Math.min(last, points.length - 1);
  showPoint();
  view.curve(points, editCurve, $("pressureEnabled").checked || editCurve);
}
function showPoint() {
  const p = points[Number($("curvePoint").value)] || [0, 0, 0];
  ["curveX", "curveY", "curveZ"].forEach(
    (id, k) => ($(id).value = Number(p[k].toFixed(4))),
  );
}
function markCurveDirty() {
  status("Curve updated. Apply pressure to regenerate geometry.");
}
async function generate(fit = false) {
  const p = params();
  const curve = view.samples(points);
  const r = await request("generate", { boundary, params: p, curve });
  needsRestore = false;
  configUsed = p;
  curveUsed = curve;
  syncDisplay(r, fit);
  status(
    `Ready · ${r.balloons.length} closed balloons · full surface containment · disjoint contact cells.`,
  );
}
function demo() {
  const g = new T.BoxGeometry(120, 90, 65);
  boundary = canonical(rawGeometry(g));
  g.dispose();
  fileName = "Demonstration container";
  $("fileName").textContent = fileName;
  $("meshSelect").hidden = true;
  $("radiusMin").value = 14;
  $("radiusMax").value = 24;
  $("clearance").value = 0.12;
  resetCurve();
}
function rhino() {
  return (rhinoPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("vendor/rhino3dm.js", document.baseURI).href;
    script.onload = () =>
      window
        .rhino3dm({
          locateFile: () =>
            new URL("vendor/rhino3dm.wasm", document.baseURI).href,
        })
        .then(resolve, reject);
    script.onerror = () =>
      reject(Error("Rhino reader could not load. Refresh and retry."));
    document.head.appendChild(script);
  }));
}
async function readMeshes(file) {
  const ext = file.name.split(".").pop().toLowerCase(),
    buffer = await file.arrayBuffer(),
    items = [];
  if (ext === "3dm") {
    const r = await rhino(),
      doc = r.File3dm.fromByteArray(new Uint8Array(buffer));
    if (!doc) throw Error("Could not read this Rhino document.");
    const objects = doc.objects();
    for (let i = 0; i < objects.count; i++) {
      const obj = objects.get(i),
        g = obj.geometry();
      if (g instanceof r.Mesh) {
        const name = obj.attributes().name || `Mesh ${i + 1}`;
        items.push({ name, raw: rhinoRaw(g) });
      }
      g.delete();
      obj.delete();
    }
    doc.delete();
  } else if (ext === "stl") {
    const g = new STLLoader().parse(buffer);
    items.push({ name: file.name, raw: rawGeometry(g) });
    g.dispose();
  } else if (ext === "obj") {
    const root = new OBJLoader().parse(new TextDecoder().decode(buffer));
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
        items.push({
          name: o.name || `Mesh ${items.length + 1}`,
          raw: rawGeometry(g),
        });
        g.dispose();
      }
    });
  } else throw Error("Choose a .3dm, .stl, or .obj mesh.");
  if (!items.length)
    throw Error(
      "No meshes found. Convert the Rhino object to a closed mesh before exporting.",
    );
  return items;
}
async function loadBoundary(raw, name) {
  const checked = canonical(raw);
  boundary = checked;
  fileName = name;
  $("fileName").textContent = name;
  const b = bounds(boundary),
    s = Math.min(...b.span);
  $("radiusMin").value = +(s * 0.21).toPrecision(4);
  $("radiusMax").value = +(s * 0.36).toPrecision(4);
  $("clearance").value = +(s * 0.002).toPrecision(4);
  $("strength").max = $("strengthN").max = String(s);
  $("influence").max = $("influenceN").max = String(s * 2);
  $("strength").value = $("strengthN").value = +(s * 0.12).toPrecision(4);
  $("influence").value = $("influenceN").value = +(s * 0.4).toPrecision(4);
  resetCurve();
  await generate(true);
}
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function currentOutput() {
  if (!output) throw Error("Build the output before exporting.");
  if (
    $("outputMode").value !== output.mode ||
    Number($("tolerance").value) !== output.tolerance
  )
    throw Error("Output settings changed. Build the output again.");
  return output;
}
function mergedRaw(shells) {
  const p = [],
    idx = [];
  for (const s of shells) {
    const off = p.length / 3;
    for (const v of s.positions) p.push(v);
    for (const i of s.indices) idx.push(i + off);
  }
  return { positions: new Float32Array(p), indices: new Uint32Array(idx) };
}
["count", "strength", "influence"].forEach((id) => {
  for (const suffix of ["", "N"])
    $(id + suffix).addEventListener(
      "input",
      () => ($(id + (suffix ? "" : "N")).value = $(id + suffix).value),
    );
});
$("generateBtn").onclick = () =>
  task("Generating smooth balloon meshes…", () => generate());
$("pressureBtn").onclick = () =>
  task("Applying curve pressure…", () => generate());
$("meshFile").onchange = () =>
  task("Reading local container…", async () => {
    const file = $("meshFile").files[0];
    if (!file) return;
    if (file.size > 50e6) throw Error("Choose a mesh file under 50 MB.");
    meshChoices = await readMeshes(file);
    $("meshSelect").replaceChildren(
      ...meshChoices.map((m, i) => new Option(m.name, i)),
    );
    $("meshSelect").hidden = meshChoices.length < 2;
    await loadBoundary(
      meshChoices[0].raw,
      `${file.name} / ${meshChoices[0].name}`,
    );
  });
$("meshSelect").onchange = () =>
  task("Loading selected boundary…", () =>
    loadBoundary(
      meshChoices[Number($("meshSelect").value)].raw,
      meshChoices[Number($("meshSelect").value)].name,
    ),
  );
$("demoBtn").onclick = () =>
  task("Restoring demonstration container…", async () => {
    demo();
    await generate(true);
  });
$("shuffleBtn").onclick = () => {
  $("pointSeed").value =
    crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
};
$("balloonSelect").onchange = () => select($("balloonSelect").value);
$("applyBalloonBtn").onclick = () =>
  task("Checking walls and neighboring balloons…", async () => {
    const edit = ["moveX", "moveY", "moveZ", "scale"].map((id) =>
      Number($(id).value),
    );
    const result = await request("edit", { index: selected, edit });
    syncDisplay(result);
    status(
      result.clamped
        ? "Edit clamped at a wall or neighboring balloon. Accepted values are shown."
        : "Individual edit applied. Containment and neighboring volumes checked.",
    );
  });
$("resetBalloonBtn").onclick = () =>
  task("Resetting selected balloon…", async () => {
    const r = await request("edit", { index: selected, edit: [0, 0, 0, 1] });
    syncDisplay(r);
    status(
      r.clamped
        ? "Reset clamped because another edited balloon occupies the baseline."
        : "Selected balloon reset to its post-pressure baseline.",
    );
  });
$("curvePoint").onchange = () => {
  view.selectedCurve = Number($("curvePoint").value);
  showPoint();
  view.attachTool();
};
$("resetCurveBtn").onclick = () => {
  resetCurve();
  markCurveDirty();
};
$("updateCurveBtn").onclick = () => {
  const p = ["curveX", "curveY", "curveZ"].map((id) => Number($(id).value));
  if (p.some((v) => !Number.isFinite(v))) {
    status("Enter finite curve coordinates.", true);
    return;
  }
  points[Number($("curvePoint").value)] = p;
  curveUI();
  markCurveDirty();
};
$("curveEditBtn").onclick = () => {
  activateTool(editCurve ? "move" : "curve");
};
$("pressureEnabled").onchange = () => {
  curveUI();
  markCurveDirty();
};
$("curveFile").onchange = () =>
  task("Reading Rhino attractor curve…", async () => {
    const file = $("curveFile").files[0];
    if (!file) return;
    const r = await rhino(),
      doc = r.File3dm.fromByteArray(new Uint8Array(await file.arrayBuffer()));
    if (!doc) throw Error("Could not read Rhino file.");
    let found;
    try {
      const objs = doc.objects();
      for (let i = 0; i < objs.count; i++) {
        const o = objs.get(i),
          g = o.geometry();
        if (!found && g instanceof r.Curve) {
          const d = g.domain;
          found = Array.from({ length: 17 }, (_, k) =>
            g.pointAt(d[0] + ((d[1] - d[0]) * k) / 16),
          );
        }
        g.delete();
        o.delete();
      }
    } finally {
      doc.delete();
    }
    if (!found)
      throw Error(
        "No Rhino curve found. Export one attractor curve in the file.",
      );
    points = found;
    curveUI();
    markCurveDirty();
  });
$("showBoundary").onchange = () => {
  if (view.boundaryGroup)
    view.boundaryGroup.visible = $("showBoundary").checked && !output?.checks;
};
$("homeBtn").onclick = () => view.fit();
$("rotateBtn").onclick = () => {
  view.orbit.autoRotate = !view.orbit.autoRotate;
  $("rotateBtn").setAttribute("aria-pressed", view.orbit.autoRotate);
};
$("wireBtn").onclick = () => {
  view.wire = !view.wire;
  $("wireBtn").setAttribute("aria-pressed", view.wire);
  view.meshes.forEach((m) =>
    m.children.forEach((c) => (c.visible = view.wire)),
  );
};
$("outputBtn").onclick = () =>
  task("Building and verifying mesh output…", async () => {
    const p = params(),
      r = await request("output", {
        mode: $("outputMode").value,
        tolerance: p.tolerance,
      });
    output = { ...r, tolerance: p.tolerance };
    $("outputStatus").textContent = r.message;
    view.output(r.mode === "boolean" ? r.shells[0] : null);
    status(r.message);
  });
$("outputMode").onchange = () => {
  invalidate();
  status("Output mode changed. Build output to preview and export.");
};
$("tolerance").oninput = invalidate;
$("exportObj").onclick = () =>
  task("Preparing OBJ export…", async () => {
    const o = currentOutput();
    let txt = "# Balloon Build — " + o.mode + "\no BalloonBuild\n",
      offset = 1;
    o.shells.forEach((s, n) => {
      txt += `g shell_${n}\n`;
      for (let i = 0; i < s.positions.length; i += 3)
        txt += `v ${s.positions[i]} ${s.positions[i + 1]} ${s.positions[i + 2]}\n`;
      for (let i = 0; i < s.indices.length; i += 3)
        txt += `f ${s.indices[i] + offset} ${s.indices[i + 1] + offset} ${s.indices[i + 2] + offset}\n`;
      offset += s.positions.length / 3;
    });
    download(txt, `balloon-build-${o.mode}.obj`, "text/plain");
    status("OBJ exported in model coordinates.");
  });
$("exportStl").onclick = () =>
  task("Preparing STL export…", async () => {
    const o = currentOutput(),
      g = geometry(mergedRaw(o.shells)),
      m = new T.Mesh(g),
      stl = new STLExporter().parse(m, { binary: true });
    download(stl, `balloon-build-${o.mode}.stl`, "application/octet-stream");
    g.dispose();
    status(
      "STL exported. Shell assembly preserves nested shells; it is not a unified solid.",
    );
  });
$("export3dm").onclick = () =>
  task("Preparing Rhino export…", async () => {
    const o = currentOutput(),
      r = await rhino(),
      doc = new r.File3dm();
    addRhinoMesh(r, doc, mergedRaw(o.shells), `Balloon Build / ${o.mode}`);
    download(
      doc.toByteArray(),
      `balloon-build-${o.mode}.3dm`,
      "application/octet-stream",
    );
    doc.delete();
    status(
      "Rhino mesh exported. Use your original model units when importing.",
    );
  });
$("saveProject").onclick = () =>
  task("Saving project…", async () => {
    if (!configUsed || !display) throw Error("Generate geometry first.");
    const obj = {
      format: "balloon-build",
      version: 1,
      fileName,
      params: configUsed,
      curve: curveUsed,
      points,
      boundary: {
        positions: Array.from(display.boundary.positions),
        indices: Array.from(display.boundary.indices),
      },
      edits: display.edits,
    };
    download(
      JSON.stringify(obj),
      "balloon-build-project.json",
      "application/json",
    );
    status(
      "Project saved with the last generated settings and accepted edits.",
    );
  });
$("projectFile").onchange = () =>
  task("Restoring project…", async () => {
    const f = $("projectFile").files[0];
    if (!f) return;
    if (f.size > 80e6) throw Error("Project is too large.");
    const obj = JSON.parse(await f.text());
    if (obj.format !== "balloon-build" || obj.version !== 1)
      throw Error("Unsupported project file.");
    for (const id of paramsIDs) $(id).value = obj.params[id];
    $("pressureEnabled").checked = !!obj.params.pressureEnabled;
    const p = params();
    if (
      !Array.isArray(obj.points) ||
      obj.points.length < 2 ||
      obj.points.length > 200 ||
      obj.points.some(
        (a) => a.length !== 3 || a.some((v) => !Number.isFinite(v)),
      )
    )
      throw Error("Invalid saved curve.");
    const raw = canonical(obj.boundary);
    if (
      !Array.isArray(obj.edits) ||
      obj.edits.length !== p.count ||
      obj.edits.some(
        (e) =>
          !Array.isArray(e) ||
          e.length !== 4 ||
          e.some((v) => !Number.isFinite(v)),
      )
    )
      throw Error("Invalid saved balloon edits.");
    boundary = raw;
    points = obj.points;
    fileName = String(obj.fileName || "Saved project");
    $("fileName").textContent = fileName;
    curveUI();
    const curve = obj.curve || view.samples(points),
      result = await request("restore", {
        boundary,
        params: p,
        curve,
        edits: obj.edits,
      });
    needsRestore = false;
    configUsed = p;
    curveUsed = curve;
    syncDisplay(result, true);
    ["count", "strength", "influence"].forEach(
      (id) => ($(id + "N").value = $(id).value),
    );
    status(
      "Project restored with saved geometry settings and collision-checked edits.",
    );
  });
$("cancelBtn").onclick = () => {
  worker.terminate();
  for (const p of pending.values())
    p.reject(Error("Operation canceled. Generate again to resume editing."));
  pending.clear();
  newWorker();
  needsRestore = true;
  invalidate();
};
$("helpBtn").onclick = () => $("help").showModal();
$("closeHelp").onclick = () => $("help").close();
newWorker();
demo();
task("Generating demonstration balloon field…", () => generate(true));
