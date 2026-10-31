import * as THREE from "three";
import { MeshBVH } from "three-mesh-bvh";

export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export function bounds(raw) {
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < raw.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k], raw.positions[i]);
    max[k] = Math.max(max[k], raw.positions[i]);
  }
  return {
    min,
    max,
    center: min.map((v, k) => (v + max[k]) / 2),
    span: min.map((v, k) => max[k] - v),
  };
}
export function canonical(raw) {
  const p = Array.from(raw.positions),
    ids = raw.indices
      ? Array.from(raw.indices)
      : p
          .map((_, i) => i)
          .filter((i) => i % 3 === 0)
          .map((i) => i / 3);
  if (
    p.length % 3 ||
    ids.length % 3 ||
    p.length < 12 ||
    p.some((v) => !Number.isFinite(v))
  )
    throw Error("Invalid mesh coordinates.");
  const b = bounds(raw),
    eps = Math.max(...b.span) * 1e-8;
  if (!(eps > 0)) throw Error("Container has no volume.");
  const map = new Map(),
    verts = [],
    remap = [];
  for (let i = 0; i < p.length; i += 3) {
    const key = p
      .slice(i, i + 3)
      .map((v) => Math.round(v / eps))
      .join(",");
    let j = map.get(key);
    if (j === undefined) {
      j = verts.length / 3;
      map.set(key, j);
      verts.push(...p.slice(i, i + 3));
    }
    remap.push(j);
  }
  const idx = [];
  for (let i = 0; i < ids.length; i += 3) {
    if (
      ids
        .slice(i, i + 3)
        .some((v) => !Number.isInteger(v) || v < 0 || v >= remap.length)
    )
      throw Error("Mesh face references an invalid vertex.");
    const t = ids.slice(i, i + 3).map((v) => remap[v]);
    if (new Set(t).size < 3)
      throw Error("Degenerate faces found. Repair the mesh in Rhino.");
    idx.push(...t);
  }
  let vol = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3,
      b = idx[i + 1] * 3,
      c = idx[i + 2] * 3;
    vol +=
      verts[a] * (verts[b + 1] * verts[c + 2] - verts[b + 2] * verts[c + 1]) +
      verts[a + 1] * (verts[b + 2] * verts[c] - verts[b] * verts[c + 2]) +
      verts[a + 2] * (verts[b] * verts[c + 1] - verts[b + 1] * verts[c]);
  }
  if (vol < 0)
    for (let i = 0; i < idx.length; i += 3)
      [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const result = {
      positions: new Float32Array(verts),
      indices: new Uint32Array(idx),
    },
    check = topology(result);
  if (!check.closed || !check.manifold || !check.valid)
    throw Error(
      "Container must be closed, consistently oriented, and manifold. Repair naked edges or degenerate faces in Rhino.",
    );
  return result;
}
export function topology(raw) {
  const edges = new Map();
  let valid =
    raw.positions.length >= 12 &&
    raw.positions.length % 3 === 0 &&
    raw.indices.length >= 12 &&
    raw.indices.length % 3 === 0;
  const p = raw.positions;
  for (let i = 0; i < raw.indices.length; i += 3) {
    const t = Array.from(raw.indices.slice(i, i + 3));
    if (
      t.some((v) => !Number.isInteger(v) || v < 0 || v * 3 + 2 >= p.length) ||
      new Set(t).size < 3
    ) {
      valid = false;
      continue;
    }
    const a = t[0] * 3,
      b = t[1] * 3,
      c = t[2] * 3,
      ab = [p[b] - p[a], p[b + 1] - p[a + 1], p[b + 2] - p[a + 2]],
      ac = [p[c] - p[a], p[c + 1] - p[a + 1], p[c + 2] - p[a + 2]];
    if (
      Math.hypot(
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ) < 1e-15
    )
      valid = false;
    for (let k = 0; k < 3; k++) {
      const a = t[k],
        b = t[(k + 1) % 3],
        key = Math.min(a, b) + ":" + Math.max(a, b);
      let e = edges.get(key) || [0, 0];
      e[0]++;
      e[1] += a < b ? 1 : -1;
      edges.set(key, e);
    }
  }
  return {
    valid: valid && Array.from(p).every(Number.isFinite),
    closed: edges.size > 0 && [...edges.values()].every((e) => e[0] === 2),
    manifold:
      edges.size > 0 &&
      [...edges.values()].every((e) => e[0] === 2 && e[1] === 0),
  };
}
export function spatial(raw) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(raw.positions), 3),
  );
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(raw.indices), 1));
  const tree = new MeshBVH(g),
    direction = new THREE.Vector3(1, 0.371390676, 0.69474659).normalize();
  const ray = new THREE.Ray(new THREE.Vector3(), direction);
  return {
    inside(p) {
      ray.origin.set(...p);
      const hits = tree
        .raycast(ray, THREE.DoubleSide)
        .map((h) => h.distance)
        .filter((t) => t > 1e-8)
        .sort((a, b) => a - b);
      let n = 0,
        last = -Infinity;
      for (const t of hits)
        if (t - last > 1e-6) {
          n++;
          last = t;
        }
      return n % 2 === 1;
    },
    dispose() {
      g.dispose();
    },
  };
}
export function populate(raw, count, seed) {
  const b = bounds(raw),
    rng = random(seed),
    s = spatial(raw),
    out = [];
  let attempts = 0;
  while (out.length < count && attempts++ < Math.max(10000, count * 3000)) {
    const p = b.min.map((v, k) => v + rng() * b.span[k]);
    if (s.inside(p)) out.push(p);
  }
  s.dispose();
  if (out.length !== count)
    throw Error(
      `Only ${out.length}/${count} interior points found. Try a different seed or a simpler boundary.`,
    );
  return out;
}
export function closestPolyline(p, curve) {
  let best = Infinity;
  for (let i = 0; i < curve.length - 1; i++) {
    const a = curve[i],
      b = curve[i + 1],
      v = b.map((x, k) => x - a[k]),
      w = p.map((x, k) => x - a[k]);
    const t = Math.max(0, Math.min(1, dot(w, v) / Math.max(1e-20, dot(v, v))));
    best = Math.min(
      best,
      dist(
        p,
        a.map((x, k) => x + v[k] * t),
      ),
    );
  }
  return best;
}

export class BalloonEngine {
  constructor(module) {
    this.m = module;
    this.boundary = null;
    this.base = [];
    this.balloons = [];
    this.edits = [];
    this.centers = [];
  }
  clear() {
    for (const s of new Set([this.boundary, ...this.base, ...this.balloons]))
      if (s) s.delete();
    this.boundary = null;
    this.base = [];
    this.balloons = [];
  }
  toSolid(raw) {
    return new this.m.Manifold(
      new this.m.Mesh({
        numProp: 3,
        vertProperties: new Float32Array(raw.positions),
        triVerts: new Uint32Array(raw.indices),
      }),
    );
  }
  raw(s) {
    const mesh = s.getMesh(),
      p = new Float32Array(mesh.numVert * 3);
    for (let i = 0; i < mesh.numVert; i++)
      for (let k = 0; k < 3; k++)
        p[i * 3 + k] = mesh.vertProperties[i * mesh.numProp + k];
    return { positions: p, indices: new Uint32Array(mesh.triVerts) };
  }
  assert(s, label) {
    if (s.status() !== "NoError" || s.isEmpty())
      throw Error(`${label}: invalid or empty solid (${s.status()}).`);
  }
  generate(raw, p, curve, progress = () => {}) {
    this.clear();
    raw = canonical(raw);
    if (raw.indices.length / 3 > 300000)
      throw Error(
        "Container exceeds 300,000 triangles. Reduce its mesh density in Rhino.",
      );
    this.boundary = this.toSolid(raw);
    this.assert(this.boundary, "Container");
    this.rawBoundary = raw;
    const centers = populate(raw, p.count, p.pointSeed),
      rng = random(p.radiusSeed),
      radii = centers.map(
        () => p.radiusMin + rng() * (p.radiusMax - p.radiusMin),
      ),
      space = spatial(raw);
    // Moderate separation before contact partitioning; centers remain verified interior points.
    for (let pass = 0; pass < 20; pass++)
      for (let i = 0; i < centers.length; i++)
        for (let j = i + 1; j < centers.length; j++) {
          const a = centers[i],
            b = centers[j],
            d = dist(a, b),
            depth = radii[i] + radii[j] - d;
          if (depth > Math.min(radii[i], radii[j]) * 0.35) {
            const v = b.map((x, k) => (x - a[k]) / Math.max(d, 1e-9)),
              step = Math.min(
                depth * 0.12,
                Math.min(radii[i], radii[j]) * 0.06,
              );
            for (const [id, sign] of [
              [i, -1],
              [j, 1],
            ]) {
              const next = centers[id].map((x, k) => x + v[k] * step * sign);
              if (space.inside(next)) centers[id] = next;
            }
          }
        }
    space.dispose();
    const made = [];
    try {
      for (let i = 0; i < centers.length; i++) {
        progress(
          i / centers.length,
          `Forming balloon ${i + 1} / ${centers.length}`,
        );
        const c = centers[i],
          r = radii[i];
        let s = this.m.Manifold.sphere(r, p.quality).translate(c);
        const replace = (next) => {
          s.delete();
          s = next;
        };
        if (p.pressureEnabled && curve.length > 1 && p.strength > 0) {
          replace(
            s.warp((v) => {
              const delta = v.map((x, k) => x - c[k]),
                len = Math.hypot(...delta),
                d = closestPolyline(v, curve),
                u = Math.max(0, 1 - d / p.influence),
                w = u * u * u * (10 + u * (-15 + 6 * u)),
                depth = Math.min(p.strength, 0.75 * len) * w;
              for (let k = 0; k < 3; k++)
                v[k] = c[k] + delta[k] * (1 - depth / len);
            }),
          );
        }
        // Common weighted contact planes define disjoint cells. Apply AFTER pressure.
        for (let j = 0; j < centers.length; j++)
          if (i !== j) {
            const d = dist(c, centers[j]);
            if (d < r + radii[j] + p.clearance) {
              const n = centers[j].map(
                  (x, k) => (x - c[k]) / Math.max(d, 1e-12),
                ),
                h = (d * r) / (r + radii[j]) - p.clearance * 0.5;
              replace(
                s.trimByPlane(
                  n.map((v) => -v),
                  -dot(n, c) - h,
                ),
              );
            }
          }
        replace(s.intersect(this.boundary));
        this.assert(
          s,
          `Balloon ${i + 1} collapsed; reduce count, radii, or gap`,
        );
        made.push(s);
      }
    } catch (e) {
      for (const s of made) s.delete();
      throw e;
    }
    this.base = made;
    this.balloons = made.map((s) => s.translate([0, 0, 0]));
    this.centers = centers;
    this.edits = made.map(() => [0, 0, 0, 1]);
    return this.snapshot();
  }
  candidate(i, edit) {
    const c = this.centers[i];
    return this.base[i]
      .translate(c.map((x) => -x))
      .scale(edit[3])
      .translate(c.map((x, k) => x + edit[k]));
  }
  safe(i, s) {
    const threshold = Math.max(1e-9, s.volume() * 1e-9);
    let cut = s.subtract(this.boundary),
      outside = cut.volume();
    cut.delete();
    if (outside > threshold) return false;
    for (let j = 0; j < this.balloons.length; j++)
      if (j !== i) {
        cut = s.intersect(this.balloons[j]);
        const volume = cut.volume();
        cut.delete();
        if (volume > threshold) return false;
      }
    return s.status() === "NoError" && !s.isEmpty();
  }
  edit(i, requested) {
    if (
      !this.base[i] ||
      requested.some((x) => !Number.isFinite(x)) ||
      requested[3] < 0.1 ||
      requested[3] > 3
    )
      throw Error("Invalid individual balloon edit.");
    let accepted = this.edits[i].slice(),
      clamped = false;
    for (const axis of [3, 0, 1, 2, 0, 1, 2]) {
      let goal = accepted.slice();
      goal[axis] = requested[axis];
      let test = this.candidate(i, goal);
      if (this.safe(i, test)) {
        accepted = goal;
        test.delete();
        continue;
      }
      test.delete();
      clamped = true;
      let lo = 0,
        hi = 1;
      for (let step = 0; step < 18; step++) {
        const t = (lo + hi) / 2,
          trial = accepted.slice();
        trial[axis] += t * (requested[axis] - accepted[axis]);
        test = this.candidate(i, trial);
        const ok = this.safe(i, test);
        test.delete();
        if (ok) lo = t;
        else hi = t;
      }
      accepted[axis] += lo * (requested[axis] - accepted[axis]);
    }
    const candidate = this.candidate(i, accepted);
    if (!this.safe(i, candidate)) {
      candidate.delete();
      throw Error("Edit could not be verified; previous balloon preserved.");
    }
    this.balloons[i].delete();
    this.balloons[i] = candidate;
    this.edits[i] = accepted;
    return { ...this.snapshot(), clamped };
  }
  restore(raw, params, curve, edits) {
    this.generate(raw, params, curve);
    if (edits.length !== this.base.length)
      throw Error("Saved edit count does not match balloon count.");
    const old = this.balloons;
    this.balloons = edits.map((e, i) => {
      if (
        e.length !== 4 ||
        e.some((v) => !Number.isFinite(v)) ||
        e[3] < 0.1 ||
        e[3] > 3
      )
        throw Error("Invalid saved edit.");
      return this.candidate(i, e);
    });
    try {
      for (let i = 0; i < this.balloons.length; i++)
        if (!this.safe(i, this.balloons[i]))
          throw Error("Saved edits fail containment or collision checks.");
    } catch (err) {
      this.balloons.forEach((s) => s.delete());
      this.balloons = old;
      throw err;
    }
    old.forEach((s) => s.delete());
    this.edits = edits.map((e) => e.slice());
    return this.snapshot();
  }
  snapshot() {
    return {
      boundary: this.rawBoundary,
      balloons: this.balloons.map((s) => this.raw(s)),
      edits: this.edits,
      centers: this.centers,
    };
  }
  output(mode, tolerance) {
    if (!this.balloons.length)
      throw Error("Generate balloons before building an output.");
    if (mode === "shell")
      return {
        mode,
        shells: [this.rawBoundary, ...this.balloons.map((s) => this.raw(s))],
        message: `Shell assembly: ${this.balloons.length + 1} separate shells. No material removed.`,
      };
    let result = this.boundary.setTolerance(tolerance);
    try {
      for (const b of this.balloons) {
        const next = result.subtract(b);
        result.delete();
        result = next;
      }
      this.assert(result, "Boolean");
      const raw = this.raw(result),
        checks = topology(raw);
      if (!checks.valid || !checks.closed || !checks.manifold)
        throw Error(
          "Boolean incomplete—not a watertight solid. Separate shells remain available.",
        );
      return {
        mode,
        shells: [raw],
        checks,
        message: "Boolean complete · Valid: yes · Closed: yes · Manifold: yes",
      };
    } finally {
      result.delete();
    }
  }
}
