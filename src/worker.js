import Module from "manifold-3d";
import wasmURL from "manifold-3d/manifold.wasm?url";
import { BalloonEngine } from "./engine.js";
let engine;
const ready = Module({ locateFile: () => wasmURL }).then((m) => {
  m.setup();
  engine = new BalloonEngine(m);
});
self.onmessage = async ({ data }) => {
  const { id, action } = data;
  try {
    await ready;
    let result;
    if (action === "generate" || action === "restore") {
      const next = new BalloonEngine(engine.m);
      try {
        result =
          action === "restore"
            ? next.restore(data.boundary, data.params, data.curve, data.edits)
            : next.generate(
                data.boundary,
                data.params,
                data.curve,
                (value, text) => postMessage({ id, progress: value, text }),
              );
      } catch (err) {
        next.clear();
        throw err;
      }
      engine.clear();
      engine = next;
    } else if (action === "edit") result = engine.edit(data.index, data.edit);
    else if (action === "output")
      result = engine.output(data.mode, data.tolerance);
    else throw Error("Unknown operation");
    postMessage({ id, result });
  } catch (error) {
    postMessage({ id, error: error.message });
  }
};
