// Convert each triangle to three planar quads without moving the source surface.
// Shared edge midpoints preserve connectivity, including along sharp boundaries.
export function quadMesh(raw) {
  if (raw.quads) return raw;
  const positions = Array.from(raw.positions),
    quads = [],
    edges = new Map();
  const normals = Array(raw.positions.length).fill(0);
  for (let i = 0; i < raw.indices.length; i += 3) {
    const [a, b, c] = Array.from(raw.indices.slice(i, i + 3), (v) => v * 3),
      p = raw.positions;
    const ux = p[b] - p[a],
      uy = p[b + 1] - p[a + 1],
      uz = p[b + 2] - p[a + 2],
      vx = p[c] - p[a],
      vy = p[c + 1] - p[a + 1],
      vz = p[c + 2] - p[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    for (const j of [a, b, c])
      for (let k = 0; k < 3; k++) normals[j + k] += n[k];
  }
  function normalizeAt(i) {
    const l = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[i + k] /= l;
  }
  for (let i = 0; i < normals.length; i += 3) normalizeAt(i);
  function averagedNormal(ids) {
    const i = normals.length;
    for (let k = 0; k < 3; k++)
      normals.push(
        ids.reduce((n, j) => n + normals[j * 3 + k], 0) / ids.length,
      );
    normalizeAt(i);
  }
  function midpoint(a, b) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edges.has(key)) return edges.get(key);
    const index = positions.length / 3;
    for (let k = 0; k < 3; k++)
      positions.push(
        positions[a * 3 + k] +
          (positions[b * 3 + k] - positions[a * 3 + k]) / 2,
      );
    averagedNormal([a, b]);
    edges.set(key, index);
    return index;
  }
  for (let i = 0; i < raw.indices.length; i += 3) {
    const [a, b, c] = raw.indices.subarray
      ? raw.indices.subarray(i, i + 3)
      : raw.indices.slice(i, i + 3);
    const ab = midpoint(a, b),
      bc = midpoint(b, c),
      ca = midpoint(c, a),
      center = positions.length / 3;
    for (let k = 0; k < 3; k++)
      positions.push(
        positions[a * 3 + k] +
          (positions[b * 3 + k] -
            positions[a * 3 + k] +
            (positions[c * 3 + k] - positions[a * 3 + k])) /
            3,
      );
    averagedNormal([a, b, c]);
    quads.push(a, ab, center, ca, b, bc, center, ab, c, ca, center, bc);
  }
  return {
    positions: new Float64Array(positions),
    quads: new Uint32Array(quads),
    normals: new Float32Array(normals),
  };
}

export function quadObj(raw, name = "QuadMesh", offset = 1) {
  const q = quadMesh(raw),
    lines = [`o ${name.replace(/[\r\n]/g, " ")}`];
  for (let i = 0; i < q.positions.length; i += 3)
    lines.push(
      `v ${q.positions[i]} ${q.positions[i + 1]} ${q.positions[i + 2]}`,
    );
  for (let i = 0; i < q.normals.length; i += 3)
    lines.push(`vn ${q.normals[i]} ${q.normals[i + 1]} ${q.normals[i + 2]}`);
  lines.push("s 1");
  for (let i = 0; i < q.quads.length; i += 4)
    lines.push(
      `f ${Array.from(q.quads.slice(i, i + 4), (v) => `${v + offset}//${v + offset}`).join(" ")}`,
    );
  return { text: lines.join("\n") + "\n", vertices: q.positions.length / 3 };
}
