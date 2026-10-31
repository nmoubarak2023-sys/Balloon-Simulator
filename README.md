# Balloon Build

A browser-based geometric balloon design studio inspired by a supplied Grasshopper definition. Built with Three.js, Rhino3dm, and Manifold WebAssembly. Black / #21E0ED styling, Helvetica Neue LT Pro where installed, perspective and plan views.

## Use

1. Import one closed, oriented, manifold mesh from Rhino (.3dm), STL, or OBJ. Convert Breps to meshes in Rhino before exporting. Select a mesh if your .3dm contains several.
2. Set interior point count and seed, radius minimum/maximum and seed, resolution, and contact gap. Generate balloons.
3. Enable pressure, edit the attractor curve in plan or through XYZ coordinates, and apply pressure. One Rhino curve can also be imported; it is sampled into editable points.
4. Select balloons by clicking either view or choosing the list. Move/scale and apply; edits clamp against neighboring balloons and the boundary. Reset restores the pressure baseline if other edits leave room.
5. Build a shell assembly (separate nested shells, no welding/union/subtraction) or Boolean subtraction. Export .3dm, OBJ, or STL. Save/open JSON projects to preserve the last generated settings, boundary, pressure curve, and accepted edits.

All modeling happens locally in the browser. Uploaded models are not sent to a server. Imports are limited to 50 MB and 300,000 boundary triangles; counts to 40 balloons. High quality uses 80 circular segments, with 128 available. Model coordinates are preserved; Rhino exports should be imported using the original model units.

## Geometry method and differences from Grasshopper

This is a browser reimplementation, not execution of the original .gh/.ghx file. It uses deterministic Mulberry32 instead of Python's random generator, so seeds reproduce results within this app, not exact Grasshopper arrangements. Rejection sampling selects points in the boundary volume. A short center relaxation spreads crowded seeds. Weighted contact planes partition overlapping spheres into disjoint regions. Pressure compresses radial distances with quintic falloff and a 25% retained core, then contact planes and solid intersection with the original boundary are reapplied. Unlike the source's vertex projection, solid intersections handle complete faces crossing concave walls. Very crowded cells can collapse; these fail with an explicit balloon index rather than being silently dropped. This is form finding, not physical gas/material simulation.

Individual edits check solid difference against the container and solid intersection against every neighboring balloon, then clamp scale and axis offsets independently. Boolean subtraction uses Manifold's tolerance setting (default 0.0001 model units) and checks valid triangles, paired oriented edges, closure, and manifold topology. These are numerical/topological checks, not a certification of manufacturing suitability. Separate input shells remain available after a failed Boolean. Self-intersecting or overlapping input boundary shells should be repaired in Rhino first; not every geometric pathology is caught by the import topology check.

The pressure tool deliberately uses inward radial compression without the source's tangential guidance. Exact RhinoCommon output is not promised. One editable attractor curve is supported in this version. .3dm import supports mesh objects, not Breps, block instances, or Rhino layers as boundaries.

## Develop

Node 22.12+ recommended.

```sh
npm ci
npm run dev
npm test
npm run build
```

`predev` and `prebuild` copy the pinned Rhino runtime from node_modules into public/vendor. Dist is fully static and uses relative asset paths, suitable for a GitHub Pages project subdirectory. WASM and the geometry worker are bundled locally, not fetched from a third-party CDN.

## GitHub Pages

In repository Settings → Pages → Build and deployment → Source, select **GitHub Actions**. The included workflow tests, builds, and publishes on pushes to main. If the initial workflow failed before Pages was enabled, rerun it from Actions → Publish Balloon Build.

Expected project URL after successful deployment: https://nmoubarak2023-sys.github.io/Balloon-Simulator/

## Typography

Helvetica Neue LT Pro is referenced through local font names only. No proprietary font file is redistributed. Provide licensed WOFF2 files to guarantee the requested typeface on other devices. Current fallbacks: Helvetica Neue, Helvetica, Arial.

## Tests

Tests cover deterministic interior sampling, rejection of open boundaries, smooth closed mesh generation, full containment and nonoverlap, pressure deformation, constrained editing/reset, concave walls, shell assembly counts, Boolean topology and volume conservation, and Rhino mesh round trip.

## Third-party licenses

Three.js and three-mesh-bvh: MIT. Manifold: Apache-2.0. Rhino3dm/OpenNURBS: McNeel's open-source licenses. See THIRD_PARTY_NOTICES.md and the respective installed package notices. Helvetica Neue LT Pro is a separate commercial font.
