import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { bounds } from "./engine.js";
export function geometry(raw) {
  const g = new T.BufferGeometry();
  g.setAttribute(
    "position",
    new T.BufferAttribute(new Float32Array(raw.positions), 3),
  );
  g.setIndex(new T.BufferAttribute(new Uint32Array(raw.indices), 1));
  g.computeVertexNormals();
  return g;
}
export function rawGeometry(g) {
  return {
    positions: new Float32Array(g.attributes.position.array),
    indices: g.index
      ? new Uint32Array(g.index.array)
      : new Uint32Array(
          Array.from({ length: g.attributes.position.count }, (_, i) => i),
        ),
  };
}
export class StudioView {
  constructor(onSelect, onCurve) {
    this.onSelect = onSelect;
    this.onCurve = onCurve;
    this.scene = new T.Scene();
    this.scene.add(new T.AmbientLight(0xaff6ff, 1.5));
    for (const [p, intensity] of [
      [[80, -100, 150], 3],
      [[-90, 80, 60], 2],
    ]) {
      const l = new T.DirectionalLight(0xaafaff, intensity);
      l.position.set(...p);
      this.scene.add(l);
    }
    this.field = new T.Group();
    this.curveGroup = new T.Group();
    this.scene.add(this.field, this.curveGroup);
    this.perspective = new T.PerspectiveCamera(38, 1, 0.01, 10000);
    this.perspective.up.set(0, 0, 1);
    this.plan = new T.OrthographicCamera(-100, 100, 100, -100, 0.01, 10000);
    this.plan.up.set(0, 1, 0);
    this.renderers = ["viewport", "planViewport"].map((id) => {
      const el = document.getElementById(id),
        r = new T.WebGLRenderer({ antialias: true, alpha: true });
      r.setPixelRatio(Math.min(devicePixelRatio, 2));
      r.setClearColor(0x000000, 0);
      r.outputColorSpace = T.SRGBColorSpace;
      el.appendChild(r.domElement);
      return r;
    });
    this.orbit = new OrbitControls(
      this.perspective,
      this.renderers[0].domElement,
    );
    this.orbit.enableDamping = true;
    this.orbit.autoRotateSpeed = 0.65;
    this.ray = new T.Raycaster();
    this.pointer = new T.Vector2();
    this.meshes = [];
    this.wire = false;
    this.editCurve = false;
    this.selected = -1;
    this.span = 120;
    this.renderers.forEach((r, i) => {
      new ResizeObserver(() => this.resize(i)).observe(
        r.domElement.parentElement,
      );
      let down;
      r.domElement.addEventListener("pointerdown", (e) => {
        down = [e.clientX, e.clientY];
        if (i === 1 && this.editCurve) {
          const hit = this.hit(e, i, this.handles || [])[0];
          if (hit) {
            this.drag = hit.object.userData.index;
            r.domElement.setPointerCapture(e.pointerId);
            e.preventDefault();
          }
        }
      });
      r.domElement.addEventListener("pointermove", (e) => {
        if (i !== 1 || this.drag === undefined) return;
        this.setRay(e, 1);
        const point = new T.Vector3();
        this.ray.ray.intersectPlane(
          new T.Plane(new T.Vector3(0, 0, 1), -this.points[this.drag][2]),
          point,
        );
        this.points[this.drag] = point.toArray();
        this.onCurve(this.points, this.drag);
      });
      r.domElement.addEventListener("pointerup", (e) => {
        if (this.drag !== undefined) {
          this.drag = undefined;
          return;
        }
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
          const hit = this.hit(e, i, this.meshes)[0];
          if (hit) this.onSelect(hit.object.userData.index);
        }
      });
    });
    this.animate();
  }
  setRay(e, i) {
    const rect = this.renderers[i].domElement.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      (-(e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.ray.setFromCamera(this.pointer, i ? this.plan : this.perspective);
  }
  hit(e, i, objects) {
    this.setRay(e, i);
    return this.ray.intersectObjects(objects, false);
  }
  resize(i) {
    const el = this.renderers[i].domElement.parentElement,
      w = el.clientWidth,
      h = el.clientHeight;
    this.renderers[i].setSize(w, h);
    if (i === 0) {
      this.perspective.aspect = w / h;
      this.perspective.updateProjectionMatrix();
    } else {
      const aspect = w / h,
        half = this.span * 0.65;
      this.plan.left = -half * aspect;
      this.plan.right = half * aspect;
      this.plan.top = half;
      this.plan.bottom = -half;
      this.plan.updateProjectionMatrix();
    }
  }
  disposeGroup(g) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        o.geometry?.dispose();
        if (o.material)
          Array.isArray(o.material)
            ? o.material.forEach((m) => m.dispose())
            : o.material.dispose();
      });
    }
  }
  show(data, fit = false) {
    this.disposeGroup(this.field);
    this.meshes = [];
    const raw = data.boundary,
      b = bounds(raw);
    this.box = b;
    this.span = Math.max(...b.span);
    this.boundaryGroup = new T.Group();
    const g = geometry(raw),
      shell = new T.Mesh(
        g,
        new T.MeshPhysicalMaterial({
          color: 0x82d7df,
          transparent: true,
          opacity: 0.06,
          side: T.DoubleSide,
          depthWrite: false,
          roughness: 0.5,
        }),
      );
    this.boundaryGroup.add(
      shell,
      new T.LineSegments(
        new T.EdgesGeometry(g, 25),
        new T.LineBasicMaterial({
          color: 0x59bbc7,
          transparent: true,
          opacity: 0.65,
        }),
      ),
    );
    this.field.add(this.boundaryGroup);
    this.boundaryGroup.visible =
      document.getElementById("showBoundary").checked;
    data.balloons.forEach((raw, i) => {
      const g = geometry(raw),
        color = new T.Color().setHSL(
          0.51 + (i % 4) * 0.009,
          0.48,
          0.43 + (i % 3) * 0.055,
        ),
        m = new T.Mesh(
          g,
          new T.MeshPhysicalMaterial({
            color,
            metalness: 0.22,
            roughness: 0.23,
            clearcoat: 0.8,
            clearcoatRoughness: 0.2,
            side: T.FrontSide,
          }),
        );
      m.userData.index = i;
      this.meshes.push(m);
      const wire = new T.Mesh(
        g,
        new T.MeshBasicMaterial({
          color: 0x9effff,
          wireframe: true,
          transparent: true,
          opacity: 0.12,
          depthWrite: false,
        }),
      );
      wire.visible = this.wire;
      m.add(wire);
      this.field.add(m);
    });
    const grid = new T.GridHelper(this.span * 1.65, 16, 0x1d434a, 0x112a30);
    grid.rotation.x = Math.PI / 2;
    grid.position.set(b.center[0], b.center[1], b.min[2] - this.span * 0.03);
    this.field.add(grid);
    this.plan.position.set(b.center[0], b.center[1], b.max[2] + this.span * 4);
    this.plan.lookAt(...b.center);
    this.plan.far = this.span * 20;
    this.plan.updateProjectionMatrix();
    this.resize(1);
    if (fit) this.fit();
    this.select(Math.min(Math.max(this.selected, 0), data.balloons.length - 1));
  }
  fit() {
    if (!this.box) return;
    const c = new T.Vector3(...this.box.center),
      radius = Math.hypot(...this.box.span) / 2,
      halfFov = Math.atan(
        Math.tan((this.perspective.fov * Math.PI) / 360) *
          Math.min(1, this.perspective.aspect),
      ),
      distance = (radius / Math.sin(halfFov)) * 1.12;
    this.perspective.position
      .copy(c)
      .add(new T.Vector3(1, -0.95, 0.8).normalize().multiplyScalar(distance));
    this.perspective.near = this.span * 0.001;
    this.perspective.far = this.span * 100;
    this.perspective.updateProjectionMatrix();
    this.orbit.target.copy(c);
    this.orbit.update();
  }
  select(index) {
    this.selected = index;
    this.meshes.forEach((m, i) => {
      m.material.emissive.setHex(i === index ? 0x083d42 : 0x000000);
      m.material.emissiveIntensity = i === index ? 0.8 : 0;
    });
  }
  curve(points, editing, visible) {
    this.points = points.map((p) => p.slice());
    this.editCurve = editing;
    this.disposeGroup(this.curveGroup);
    this.handles = [];
    if (points.length < 2 || !visible) return;
    const spline = new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...p)),
      false,
      "centripetal",
    );
    this.curveSamples = spline
      .getPoints(Math.max(100, points.length * 12))
      .map((p) => p.toArray());
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints(
        this.curveSamples.map((p) => new T.Vector3(...p)),
      ),
      new T.LineBasicMaterial({
        color: 0x21e0ed,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    line.renderOrder = 10;
    this.curveGroup.add(line);
    if (editing)
      points.forEach((p, i) => {
        const handle = new T.Mesh(
          new T.SphereGeometry(this.span * 0.012, 16, 12),
          new T.MeshBasicMaterial({ color: 0xd4fcff, depthTest: false }),
        );
        handle.position.set(...p);
        handle.userData.index = i;
        handle.renderOrder = 20;
        this.handles.push(handle);
        this.curveGroup.add(handle);
      });
  }
  samples(points) {
    return new T.CatmullRomCurve3(
      points.map((p) => new T.Vector3(...p)),
      false,
      "centripetal",
    )
      .getPoints(Math.max(100, points.length * 12))
      .map((p) => p.toArray());
  }
  output(raw) {
    if (this.result) {
      this.field.remove(this.result);
      this.result.geometry.dispose();
      this.result.material.dispose();
    }
    this.result = null;
    if (raw) {
      this.meshes.forEach((m) => (m.visible = false));
      this.boundaryGroup.visible = false;
      this.result = new T.Mesh(
        geometry(raw),
        new T.MeshPhysicalMaterial({
          color: 0x4e9fa9,
          metalness: 0.25,
          roughness: 0.28,
          side: T.DoubleSide,
        }),
      );
      this.field.add(this.result);
    } else {
      this.meshes.forEach((m) => (m.visible = true));
      this.boundaryGroup.visible =
        document.getElementById("showBoundary").checked;
    }
  }
  animate() {
    requestAnimationFrame(() => this.animate());
    this.orbit.update();
    this.renderers[0].render(this.scene, this.perspective);
    this.renderers[1].render(this.scene, this.plan);
  }
}
