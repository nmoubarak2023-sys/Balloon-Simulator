import cdt2d from "cdt2d";
import { random } from "./engine.js";
import { meshQuality, signedVolume } from "./mesh-quality.js";
export function voronoiBuild(m, p) {
  const {
    width: w,
    height: h,
    count,
    seed,
    index,
    selected,
    radiusMin,
    radiusMax,
    radiusSeed,
    floor,
    spacing,
    smoothing,
  } = p;
  if (
    !Object.values(p).every(Number.isFinite) ||
    !Number.isInteger(selected) ||
    !Number.isInteger(smoothing) ||
    ![40, 80, 160].includes(w) ||
    h !== w * 0.625 ||
    !Number.isInteger(count) ||
    count < 1 ||
    count > 150 ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= count ||
    selected < 1 ||
    selected > count ||
    radiusMin <= 0 ||
    radiusMax <= Math.abs(floor) ||
    radiusMax < radiusMin ||
    spacing < 0.5 ||
    spacing > 10 ||
    smoothing < 0 ||
    smoothing > 20
  )
    throw Error(
      "Check count, selected index, radii, floor height and spacing. The floor must intersect at least one sphere.",
    );
  const rng = random(seed),
    points = Array.from({ length: count }, () => [rng() * w, rng() * h]);
  const cells = points.map((a, i) => {
    let poly = [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ];
    points.forEach((b, j) => {
      if (i === j) return;
      const nx = b[0] - a[0],
        ny = b[1] - a[1],
        d = (b[0] ** 2 + b[1] ** 2 - a[0] ** 2 - a[1] ** 2) / 2,
        next = [];
      for (let k = 0; k < poly.length; k++) {
        const u = poly[k],
          v = poly[(k + 1) % poly.length],
          du = nx * u[0] + ny * u[1] - d,
          dv = nx * v[0] + ny * v[1] - d;
        if (du <= 1e-9) next.push(u);
        if (du < 0 !== dv < 0) {
          const t = du / (du - dv);
          next.push([u[0] + t * (v[0] - u[0]), u[1] + t * (v[1] - u[1])]);
        }
      }
      poly = next;
    });
    return poly;
  });
  const ids = points
    .map((a, i) => ({
      i,
      d: (a[0] - points[index][0]) ** 2 + (a[1] - points[index][1]) ** 2,
    }))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .slice(0, selected)
    .map((a) => a.i);
  const rr = random(radiusSeed),
    spheres = ids.map((id) => ({
      id,
      center: points[id],
      radius: radiusMin + rr() * (radiusMax - radiusMin),
    }));
  const owned = [],
    own = (x) => (owned.push(x), x);
  try {
    const rectangle = own(m.CrossSection.square([w, h]));
    const circles = spheres
      .filter((s) => s.radius > Math.abs(floor))
      .map((s) =>
        own(
          own(
            m.CrossSection.circle(
              Math.sqrt(s.radius ** 2 - floor ** 2),
              Math.max(64, Math.ceil((2 * Math.PI * s.radius) / spacing)),
            ),
          ).translate(s.center),
        ),
      );
    const footprint = own(
      own(m.CrossSection.union(circles)).intersect(rectangle),
    );
    const loops = footprint.toPolygons();
    if (!loops.length)
      throw Error("The floor plane does not intersect the balloons.");
    // Uniform interior samples and constrained Delaunay triangles avoid the
    // long fan diagonals inherited from triangulating the outline alone.
    const xy = [],
      constraints = [];
    for (const loop of loops) {
      const ids = [];
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i],
          b = loop[(i + 1) % loop.length],
          n = Math.max(
            1,
            Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / spacing),
          );
        for (let j = 0; j < n; j++) {
          ids.push(xy.length);
          xy.push([
            a[0] + ((b[0] - a[0]) * j) / n,
            a[1] + ((b[1] - a[1]) * j) / n,
          ]);
        }
      }
      ids.forEach((id, i) => constraints.push([id, ids[(i + 1) % ids.length]]));
    }
    const inside = ([x, y]) => {
      let hit = false;
      for (const loop of loops)
        for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
          const a = loop[i],
            b = loop[j];
          if (
            a[1] > y !== b[1] > y &&
            x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]
          )
            hit = !hit;
        }
      return hit;
    };
    const distance = (p, a, b) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        t = Math.max(
          0,
          Math.min(
            1,
            ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
          ),
        );
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    for (
      let row = 0, y = spacing * 0.5;
      y < h;
      y += (spacing * Math.sqrt(3)) / 2, row++
    )
      for (let x = spacing * (row % 2 ? 0.5 : 1); x < w; x += spacing) {
        const p = [x, y];
        if (
          inside(p) &&
          !constraints.some(
            ([a, b]) => distance(p, xy[a], xy[b]) < spacing * 0.22,
          )
        )
          xy.push(p);
      }
    if (xy.length > 100000)
      throw Error("Mesh spacing is too fine; increase it.");
    const tris = cdt2d(xy, constraints, { exterior: false });
    const edges = new Map(),
      neighbors = xy.map(() => new Set());
    for (const t of tris)
      for (let k = 0; k < 3; k++) {
        const a = t[k],
          b = t[(k + 1) % 3],
          key = Math.min(a, b) + ":" + Math.max(a, b);
        if (edges.has(key)) edges.get(key).count++;
        else edges.set(key, { a, b, count: 1 });
        neighbors[a].add(b);
        neighbors[b].add(a);
      }
    const boundary = new Set();
    for (const e of edges.values())
      if (e.count === 1) {
        boundary.add(e.a);
        boundary.add(e.b);
      }
    let z = xy.map(([x, y]) =>
      Math.max(
        floor,
        ...spheres.map((s) => {
          const q =
            s.radius ** 2 - (x - s.center[0]) ** 2 - (y - s.center[1]) ** 2;
          return q >= 0 ? Math.sqrt(q) : -Infinity;
        }),
      ),
    );
    // On curved footprint edges the section and sphere meet at the floor.
    // Chord interpolation must not invent a rippled skirt between section points.
    for (const i of boundary) {
      const [x, y] = xy[i];
      if (
        Math.min(Math.abs(x), Math.abs(x - w), Math.abs(y), Math.abs(y - h)) >
        1e-6
      )
        z[i] = Math.abs(floor);
    }
    // Keep footprint vertices fixed; relax only interior roof heights vertically.
    for (let i = 0; i < smoothing; i++)
      z = z.map((v, k) =>
        boundary.has(k)
          ? v
          : Math.max(
              floor + 1e-6,
              0.5 * v +
                (0.5 * [...neighbors[k]].reduce((s, j) => s + z[j], 0)) /
                  neighbors[k].size,
            ),
      );
    const pos = [],
      top = [],
      bottom = [];
    xy.forEach(([x, y], i) => {
      top[i] = pos.length / 3;
      pos.push(x, y, z[i]);
      if (boundary.has(i) && Math.abs(z[i] - floor) < 1e-7) bottom[i] = top[i];
      else {
        bottom[i] = pos.length / 3;
        pos.push(x, y, floor);
      }
    });
    const idx = [],
      add = (a, b, c) => {
        if (a !== b && b !== c && c !== a) idx.push(a, b, c);
      };
    for (const [a, b, c] of tris) {
      add(top[a], top[b], top[c]);
      add(bottom[c], bottom[b], bottom[a]);
    }
    for (const e of edges.values())
      if (e.count === 1) {
        add(top[e.a], bottom[e.a], bottom[e.b]);
        add(top[e.a], bottom[e.b], top[e.b]);
      }
    const raw = {
      positions: new Float64Array(pos),
      indices: new Uint32Array(idx),
    };
    if (signedVolume(raw) < 0)
      for (let i = 0; i < raw.indices.length; i += 3)
        [raw.indices[i + 1], raw.indices[i + 2]] = [
          raw.indices[i + 2],
          raw.indices[i + 1],
        ];
    const parent = xy.map((_, i) => i),
      root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
    for (const [a, b, c] of tris) {
      parent[root(b)] = root(a);
      parent[root(c)] = root(a);
    }
    const components = new Set(xy.map((_, i) => root(i))).size,
      q = meshQuality(raw);
    return {
      raw,
      points,
      cells,
      ids,
      spheres,
      loops,
      quality: q,
      components,
      volume: signedVolume(raw),
      params: p,
      closed: !q.boundaryEdges && !q.nonManifoldEdges && !q.degenerateFaces,
    };
  } finally {
    owned.reverse().forEach((x) => x.delete());
  }
}
