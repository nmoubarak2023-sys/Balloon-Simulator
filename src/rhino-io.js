export function rhinoRaw(mesh) {
  const verts = mesh.vertices(),
    faces = mesh.faces(),
    p = [],
    idx = [];
  for (let i = 0; i < verts.count; i++) p.push(...verts.point3dAt(i));
  for (let i = 0; i < faces.count; i++) {
    const f = faces.get(i);
    idx.push(f[0], f[1], f[2]);
    if (f[2] !== f[3]) idx.push(f[0], f[2], f[3]);
  }
  return { positions: new Float64Array(p), indices: new Uint32Array(idx) };
}
export function addRhinoMesh(r, doc, raw, name) {
  const mesh = new r.Mesh();
  mesh.vertices().useDoublePrecisionVertices = true;
  for (let i = 0; i < raw.positions.length; i += 3)
    mesh.vertices().addPoint3d(...raw.positions.slice(i, i + 3));
  for (let i = 0; i < raw.indices.length; i += 3)
    mesh.faces().addTriFace(...raw.indices.slice(i, i + 3));
  mesh.normals().computeNormals();
  const attr = new r.ObjectAttributes();
  attr.name = name;
  doc.objects().addMesh(mesh, attr);
  attr.delete();
  mesh.delete();
}
