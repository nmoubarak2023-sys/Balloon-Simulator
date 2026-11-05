import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { geometry } from "./view.js";
import { addRhinoMesh } from "./rhino-io.js";
export function initVoronoi(workerFactory, rhino) {
  const existing = document.querySelector("main"),
    pane = document.createElement("main");
  pane.id = "voronoiWorkspace";
  pane.hidden = true;
  const nav = document.createElement("nav");
  nav.className = "simulation-tabs";
  nav.setAttribute("aria-label", "Simulation workspaces");
  nav.innerHTML =
    '<button aria-pressed="true">BALLOON BUILD</button><button aria-pressed="false">VORONOI BALLOONS</button>';
  existing.before(nav);
  existing.after(pane);
  const fields = [
    ["count", "Seed point count", 40, 1, 150, 1],
    ["seed", "Point seed", 42, 0, 9999, 1],
    ["index", "Anchor point index (0 based)", 0, 0, 39, 1],
    ["selected", "Nearest points selected", 17, 1, 40, 1],
    ["radiusMin", "Radius min (ft)", 15, 1, 60, 0.5],
    ["radiusMax", "Radius max (ft)", 25, 1, 80, 0.5],
    ["radiusSeed", "Radius seed", 17, 0, 9999, 1],
    ["floor", "Floor plane Z (ft)", 0, -20, 20, 0.5],
    ["spacing", "Mesh spacing (ft)", 2, 0.5, 10, 0.5],
    ["smoothing", "Valley smoothing passes", 4, 0, 20, 1],
  ];
  pane.innerHTML = `<div class="voro-layout"><section class="panel"><div class="panel-heading"><span>PERSPECTIVE <small>01 / VORONOI BALLOONS</small></span><button id="vFit">FIT ↗</button></div><div class="canvas-tools"><button id="vRoof" aria-pressed="true">ENCLOSURE</button><button id="vSpheres" aria-pressed="false">BALLOONS</button><button id="vWire" aria-pressed="false">WIRE</button></div><div id="vPerspective" class="voro-canvas"></div><div class="viewer-footer">ROOF / FLAT FLOOR / PERIMETER ONLY</div></section><aside><section class="panel"><div class="panel-heading">PLAN VIEW <small>02 / CELLS & SELECTED SEEDS</small></div><div id="vPlan" class="voro-plan"></div></section><section class="panel"><div class="panel-heading">CONTROL PANEL <small>03 / INDEPENDENT SIMULATION</small></div><div class="voro-controls"><label>Boundary rectangle (ft)<select id="vSize"><option value="160">160 × 100</option><option value="80" selected>80 × 50</option><option value="40">40 × 25</option></select></label>${fields.map(([id, label, value, min, max, step]) => `<div class="control"><label for="v_${id}">${label}</label><input id="vn_${id}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" aria-label="${label}"><input id="v_${id}" type="range" value="${value}" min="${min}" max="${max}" step="${step}"></div>`).join("")}<button id="vGenerate" class="primary">GENERATE ENCLOSURE ↗</button><p class="note">Nearest-point selection retains original Voronoi cells. The roof uses the highest original sphere surface; smoothing changes interior heights only. Disconnected footprints remain separate and are reported.</p><div class="pair"><button id="vObj">EXPORT .OBJ</button><button id="v3dm">EXPORT .3DM</button></div><button id="vSave">SAVE SETTINGS & DATA</button><label class="button" for="vLoad">OPEN VORONOI PROJECT</label><input hidden id="vLoad" type="file" accept=".json"><pre id="vReport" class="iteration-report">Generate an enclosure to check its mesh.</pre></div></section></aside></div><div class="status-bar" id="vStatus" role="status">Ready to generate.</div>`;
  const $ = (id) => pane.querySelector("#" + id);
  let worker,
    result,
    pending = false,
    mode = "roof",
    wire = false,
    fitNext = true;
  const scene = new T.Scene(),
    group = new T.Group();
  scene.add(group, new T.AmbientLight(0xaff6ff, 2));
  const light = new T.DirectionalLight(0xaff6ff, 3);
  light.position.set(80, -80, 140);
  scene.add(light);
  const camera = new T.PerspectiveCamera(38, 1, 0.01, 10000);
  camera.up.set(0, 0, 1);
  const plan = new T.OrthographicCamera(-50, 50, 35, -35, 0.01, 10000);
  plan.up.set(0, 1, 0);
  const renderers = ["vPerspective", "vPlan"].map((id) => {
    const r = new T.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setClearColor(0, 0);
    $(id).append(r.domElement);
    return r;
  });
  const orbit = new OrbitControls(camera, renderers[0].domElement);
  orbit.enableDamping = true;
  const diagram = new T.Scene();
  function resize() {
    renderers.forEach((r, i) => {
      const el = r.domElement.parentElement,
        w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) return;
      r.setSize(w, h, false);
      if (!i) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      } else if (result) {
        const width = result.params.width,
          height = result.params.height,
          aspect = w / h;
        plan.left = -Math.max(width, height * aspect) * 0.58;
        plan.right = -plan.left;
        plan.top = plan.right / aspect;
        plan.bottom = -plan.top;
        plan.updateProjectionMatrix();
      }
    });
  }
  renderers.forEach((r) =>
    new ResizeObserver(resize).observe(r.domElement.parentElement),
  );
  function clear(g) {
    for (const child of [...g.children]) {
      g.remove(child);
      child.traverse((o) => {
        o.geometry?.dispose();
        if (o.material) o.material.dispose();
      });
    }
  }
  function fit() {
    if (!result) return;
    const { width: w, height: h } = result.params;
    orbit.target.set(w / 2, h / 2, 0);
    camera.position.set(w * 1.1, -w * 0.9, w * 0.9);
    camera.lookAt(orbit.target);
    plan.position.set(w / 2, h / 2, w * 3);
    plan.lookAt(w / 2, h / 2, 0);
    resize();
  }
  function draw() {
    clear(group);
    clear(diagram);
    if (!result) return;
    if (mode === "roof") {
      const mat = new T.MeshPhysicalMaterial({
        color: 0x4e9fa9,
        roughness: 0.3,
        metalness: 0.2,
        side: T.DoubleSide,
        wireframe: wire,
      });
      group.add(new T.Mesh(geometry(result.raw), mat));
    } else {
      const { width: w, height: h, floor } = result.params;
      const planes = [
        new T.Plane(new T.Vector3(1, 0, 0), 0),
        new T.Plane(new T.Vector3(-1, 0, 0), w),
        new T.Plane(new T.Vector3(0, 1, 0), 0),
        new T.Plane(new T.Vector3(0, -1, 0), h),
        new T.Plane(new T.Vector3(0, 0, 1), -floor),
      ];
      renderers[0].localClippingEnabled = true;
      for (const s of result.spheres) {
        const mesh = new T.Mesh(
          new T.SphereGeometry(s.radius, 64, 40),
          new T.MeshPhysicalMaterial({
            color: 0x4e9fa9,
            roughness: 0.3,
            metalness: 0.2,
            transparent: true,
            opacity: 0.7,
            side: T.DoubleSide,
            wireframe: wire,
            clippingPlanes: planes,
          }),
        );
        mesh.position.set(...s.center, 0);
        group.add(mesh);
      }
    }
    const chosen = new Set(result.ids);
    result.cells.forEach((cell, i) => {
      if (!cell.length) return;
      const line = new T.LineLoop(
        new T.BufferGeometry().setFromPoints(
          cell.map((p) => new T.Vector3(...p, 0)),
        ),
        new T.LineBasicMaterial({
          color: chosen.has(i) ? 0xdc24f4 : 0x21e0ed,
          transparent: true,
          opacity: chosen.has(i) ? 1 : 0.45,
        }),
      );
      diagram.add(line);
      const dot = new T.Mesh(
        new T.CircleGeometry(result.params.width * 0.006, 10),
        new T.MeshBasicMaterial({
          color:
            i === result.params.index
              ? 0xffffff
              : chosen.has(i)
                ? 0xdc24f4
                : 0x21e0ed,
        }),
      );
      dot.position.set(...result.points[i], 0.1);
      diagram.add(dot);
    });
    for (const loop of result.loops) {
      const outline = new T.LineLoop(
        new T.BufferGeometry().setFromPoints(
          loop.map((p) => new T.Vector3(...p, 0.2)),
        ),
        new T.LineBasicMaterial({ color: 0xffffff }),
      );
      diagram.add(outline);
    }
    if (fitNext) {
      fit();
      fitNext = false;
    }
  }
  function parameters() {
    const width = Number($("vSize").value);
    return {
      width,
      height: width * 0.625,
      ...Object.fromEntries(
        fields.map(([id]) => [id, Number($("vn_" + id).value)]),
      ),
    };
  }
  function generate() {
    if (pending) return;
    pending = true;
    $("vStatus").textContent = "Building footprint, roof and flat floor…";
    $("vGenerate").disabled = true;
    worker ??= workerFactory();
    worker.onmessage = ({ data }) => {
      pending = false;
      $("vGenerate").disabled = false;
      if (data.error) {
        $("vStatus").textContent = data.error;
        return;
      }
      result = data.result;
      draw();
      const q = result.quality;
      $("vReport").textContent = JSON.stringify(
        {
          connectedComponents: result.components,
          closed: result.closed,
          nakedEdges: q.boundaryEdges,
          nonManifoldEdges: q.nonManifoldEdges,
          degenerateFaces: q.degenerateFaces,
          triangles: q.triangles,
          volumeCubicFeet: result.volume,
          selectedOriginalIndices: result.ids,
        },
        null,
        2,
      );
      $("vStatus").textContent =
        result.closed && result.components === 1
          ? "One connected closed enclosure · 0 naked edges · 0 non-manifold edges"
          : `${result.components} component(s) · ${q.boundaryEdges} naked edges · ${q.nonManifoldEdges} non-manifold edges. Review the mesh report.`;
      if (JSON.stringify(parameters()) !== JSON.stringify(result.params))
        generate();
    };
    worker.onerror = (e) => {
      pending = false;
      $("vGenerate").disabled = false;
      $("vStatus").textContent = e.message;
    };
    worker.postMessage({ id: 1, action: "voronoi", params: parameters() });
  }
  fields.forEach(([id]) => {
    const range = $("v_" + id),
      number = $("vn_" + id);
    range.oninput = () => {
      number.value = range.value;
    };
    number.oninput = () => {
      range.value = number.value;
    };
    for (const input of [range, number])
      input.onchange = () => {
        if (id === "count") {
          const n = Number(number.value);
          for (const name of ["index", "selected"])
            for (const prefix of ["v_", "vn_"]) {
              const el = $(prefix + name);
              el.max = name === "index" ? n - 1 : n;
              el.value = Math.min(Number(el.value), Number(el.max));
            }
        }
        generate();
      };
  });
  $("vSize").onchange = () => {
    fitNext = true;
    generate();
  };
  $("vGenerate").onclick = generate;
  $("vFit").onclick = fit;
  $("vRoof").onclick = () => {
    mode = "roof";
    $("vRoof").setAttribute("aria-pressed", true);
    $("vSpheres").setAttribute("aria-pressed", false);
    draw();
  };
  $("vSpheres").onclick = () => {
    mode = "spheres";
    $("vRoof").setAttribute("aria-pressed", false);
    $("vSpheres").setAttribute("aria-pressed", true);
    draw();
  };
  $("vWire").onclick = () => {
    wire = !wire;
    $("vWire").setAttribute("aria-pressed", wire);
    draw();
  };
  const download = (data, name) => {
    const url = URL.createObjectURL(new Blob([data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  function accepted() {
    if (!result) throw Error("Generate an enclosure first.");
    if (JSON.stringify(parameters()) !== JSON.stringify(result.params))
      throw Error("Controls changed. Generate again before exporting.");
    return result;
  }
  const guarded = (fn) => async () => {
    try {
      await fn();
    } catch (e) {
      $("vStatus").textContent = e.message;
    }
  };
  $("vObj").onclick = guarded(() => {
    const { raw } = accepted();
    let text = "o VoronoiBalloons\n";
    for (let i = 0; i < raw.positions.length; i += 3)
      text += `v ${raw.positions.slice(i, i + 3).join(" ")}\n`;
    for (let i = 0; i < raw.indices.length; i += 3)
      text += `f ${Array.from(raw.indices.slice(i, i + 3), (v) => v + 1).join(" ")}\n`;
    download(text, "voronoi-balloons.obj");
  });
  $("v3dm").onclick = guarded(async () => {
    const r = await rhino(),
      doc = new r.File3dm();
    try {
      doc.settings().modelUnitSystem = r.UnitSystem.Feet;
      addRhinoMesh(r, doc, accepted().raw, "Voronoi Balloons / enclosure");
      download(doc.toByteArray(), "voronoi-balloons.3dm");
    } finally {
      doc.delete();
    }
  });
  $("vSave").onclick = guarded(() =>
    download(
      JSON.stringify(
        { format: "voronoi-balloons", version: 1, ...accepted() },
        (_, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v),
      ),
      "voronoi-balloons.json",
    ),
  );
  $("vLoad").onchange = guarded(async () => {
    const file = $("vLoad").files[0];
    if (!file) return;
    const data = JSON.parse(await file.text());
    if (data.format !== "voronoi-balloons")
      throw Error("Open a Voronoi Balloons project.");
    $("vSize").value = data.params.width;
    for (const [id] of fields) {
      $("vn_" + id).value = data.params[id];
      $("v_" + id).value = data.params[id];
    }
    fitNext = true;
    generate();
  });
  [...nav.children].forEach(
    (button, i) =>
      (button.onclick = () => {
        existing.hidden = !!i;
        pane.hidden = !i;
        document.querySelector(".header-actions").hidden = !!i;
        [...nav.children].forEach((b, j) =>
          b.setAttribute("aria-pressed", i === j),
        );
        if (i) {
          resize();
          if (!result && !pending) generate();
        }
      }),
  );
  function frame() {
    requestAnimationFrame(frame);
    if (pane.hidden) return;
    orbit.update();
    renderers[0].render(scene, camera);
    renderers[1].render(diagram, plan);
  }
  frame();
}
