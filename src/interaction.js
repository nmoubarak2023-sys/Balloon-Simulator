import { Matrix4, Vector3 } from "three";

export function transformMesh(raw, matrix) {
  const m = new Matrix4().fromArray(matrix),
    p = new Vector3(),
    positions = new Float32Array(raw.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    p.fromArray(raw.positions, i).applyMatrix4(m).toArray(positions, i);
  }
  return { positions, indices: new Uint32Array(raw.indices) };
}
export function uniformFactor(scale) {
  return scale.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
}
export function draggedEdit(previous, delta, ratio = 1) {
  if (
    !previous ||
    delta.some((v) => !Number.isFinite(v)) ||
    !Number.isFinite(ratio)
  )
    throw Error("Invalid canvas transform.");
  return [
    ...delta.map((v, k) => previous[k] + v),
    Math.max(0.1, Math.min(3, previous[3] * ratio)),
  ];
}
