/**
 * detector.js — Only detection.
 *
 * This project ships WITHOUT a trained YOLOv8 model (training and
 * exporting one is outside what can be included here). Two backends
 * are supported, chosen automatically:
 *
 *  1. "onnx"     — if /ai/yolov8_ball.onnx exists, load ONNX Runtime
 *                  Web and run real inference. Drop a model file at
 *                  that path and this activates with no code changes.
 *  2. "heuristic"— otherwise, a lightweight frame-differencing +
 *                  colour-blob detector that looks for a small, fast,
 *                  roughly circular object (cricket balls are red or
 *                  white and move much faster than anything else in
 *                  frame). It's not as robust as a trained model but
 *                  needs no download and runs in real time on-device.
 *
 * Either backend returns the same shape from detect():
 *   { ball: {x,y,r,conf} | null, boxes: [{label,x,y,w,h,conf}, ...] }
 * (x,y are centre coordinates in source-frame pixels)
 */
const Detector = (() => {
  const MODEL_URL = "ai/yolov8_ball.onnx";
  const LABELS_URL = "ai/labels.txt";
  let backend = null; // "onnx" | "heuristic"
  let session = null;
  let labels = ["ball", "bat", "stumps", "crease"];
  let prevGray = null;
  let workCanvas, workCtx;
  const WORK_SIZE = 320; // downscale for speed on the heuristic path

  async function init() {
    workCanvas = document.createElement("canvas");
    workCanvas.width = WORK_SIZE;
    workCanvas.height = WORK_SIZE;
    workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

    const modelAvailable = await headOk(MODEL_URL);
    if (modelAvailable) {
      try {
        await loadOrt();
        session = await ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ["wasm"],
        });
        const labelText = await fetch(LABELS_URL).then((r) => (r.ok ? r.text() : ""));
        if (labelText) labels = labelText.split("\n").map((s) => s.trim()).filter(Boolean);
        backend = "onnx";
      } catch (err) {
        console.warn("[detector] model present but failed to load, falling back:", err);
        backend = "heuristic";
      }
    } else {
      backend = "heuristic";
    }
    return backend;
  }

  async function headOk(url) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  function loadOrt() {
    return new Promise((resolve, reject) => {
      if (window.ort) return resolve();
      const s = document.createElement("script");
      s.src = window.__ORT_CDN__;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Failed to load ONNX Runtime Web"));
      document.head.appendChild(s);
    });
  }

  /** Main entry point — called once per animation frame with the live <video>. */
  async function detect(videoEl) {
    if (backend === "onnx") return detectOnnx(videoEl);
    return detectHeuristic(videoEl);
  }

  // ---------- ONNX backend ----------
  async function detectOnnx(videoEl) {
    // Standard YOLOv8 preprocessing: letterbox to 640x640, NCHW, 0-1 float.
    const size = 640;
    workCanvas.width = size;
    workCanvas.height = size;
    workCtx.drawImage(videoEl, 0, 0, size, size);
    const { data } = workCtx.getImageData(0, 0, size, size);

    const chw = new Float32Array(3 * size * size);
    for (let i = 0; i < size * size; i++) {
      chw[i] = data[i * 4] / 255; // R
      chw[size * size + i] = data[i * 4 + 1] / 255; // G
      chw[2 * size * size + i] = data[i * 4 + 2] / 255; // B
    }
    const tensor = new ort.Tensor("float32", chw, [1, 3, size, size]);
    const feeds = { images: tensor };
    const out = await session.run(feeds);
    const outputName = Object.keys(out)[0];
    const raw = out[outputName].data; // [1, num_boxes, 4+num_classes] flattened, model-specific

    const boxes = parseYolo(raw, out[outputName].dims, labels, videoEl.videoWidth, videoEl.videoHeight, size);
    const ball = boxes.filter((b) => b.label === "ball").sort((a, b) => b.conf - a.conf)[0];
    return {
      ball: ball ? { x: ball.x + ball.w / 2, y: ball.y + ball.h / 2, r: Math.max(ball.w, ball.h) / 2, conf: ball.conf } : null,
      boxes,
    };
  }

  function parseYolo(raw, dims, labelSet, srcW, srcH, modelSize) {
    // Generic-enough YOLOv8 export parser: dims ~ [1, 4+numClasses, numBoxes]
    const numClasses = labelSet.length;
    const stride = dims[1];
    const numBoxes = dims[2];
    const scaleX = srcW / modelSize;
    const scaleY = srcH / modelSize;
    const boxes = [];
    const CONF_THRESH = 0.35;
    for (let i = 0; i < numBoxes; i++) {
      const cx = raw[0 * numBoxes + i];
      const cy = raw[1 * numBoxes + i];
      const w = raw[2 * numBoxes + i];
      const h = raw[3 * numBoxes + i];
      let bestClass = 0, bestScore = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = raw[(4 + c) * numBoxes + i];
        if (score > bestScore) { bestScore = score; bestClass = c; }
      }
      if (bestScore < CONF_THRESH) continue;
      boxes.push({
        label: labelSet[bestClass] || `class${bestClass}`,
        x: (cx - w / 2) * scaleX,
        y: (cy - h / 2) * scaleY,
        w: w * scaleX,
        h: h * scaleY,
        conf: bestScore,
      });
      if (stride < 4 + numClasses) break; // malformed export guard
    }
    return boxes;
  }

  // ---------- Heuristic backend ----------
  // Frame-differencing to find motion, then a colour + circularity check
  // on the moving region to decide whether it looks like a ball.
  function detectHeuristic(videoEl) {
    workCtx.drawImage(videoEl, 0, 0, WORK_SIZE, WORK_SIZE);
    const frame = workCtx.getImageData(0, 0, WORK_SIZE, WORK_SIZE);
    const gray = toGray(frame.data);

    let candidate = null;
    if (prevGray) {
      candidate = findMovingBlob(gray, prevGray, frame.data);
    }
    prevGray = gray;

    if (!candidate) return { ball: null, boxes: [] };

    const scaleX = videoEl.videoWidth / WORK_SIZE;
    const scaleY = videoEl.videoHeight / WORK_SIZE;
    const ball = {
      x: candidate.x * scaleX,
      y: candidate.y * scaleY,
      r: candidate.r * ((scaleX + scaleY) / 2),
      conf: candidate.score,
    };
    return { ball, boxes: [{ label: "ball", x: ball.x - ball.r, y: ball.y - ball.r, w: ball.r * 2, h: ball.r * 2, conf: ball.score }] };
  }

  function toGray(rgba) {
    const n = rgba.length / 4;
    const out = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out[i] = (rgba[o] * 0.3 + rgba[o + 1] * 0.59 + rgba[o + 2] * 0.11);
    }
    return out;
  }

  function findMovingBlob(gray, prevGray, rgba) {
    const w = WORK_SIZE, h = WORK_SIZE;
    const DIFF_THRESH = 28;
    let minX = w, minY = h, maxX = 0, maxY = 0, count = 0;
    let sumColorScore = 0;

    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const i = y * w + x;
        const d = Math.abs(gray[i] - prevGray[i]);
        if (d > DIFF_THRESH) {
          // Ball-ish colour check: bright white leather or red seam ball.
          const o = i * 4;
          const r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
          const isWhiteBall = r > 170 && g > 170 && b > 170;
          const isRedBall = r > 120 && r - g > 40 && r - b > 40;
          if (isWhiteBall || isRedBall) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            count++;
            sumColorScore += 1;
          }
        }
      }
    }

    if (count < 4) return null; // too little evidence
    const bw = maxX - minX, bh = maxY - minY;
    const area = bw * bh;
    if (area <= 0 || area > (w * h) * 0.12) return null; // discard huge diffs (camera shake, etc.)

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const r = Math.max(4, Math.max(bw, bh) / 2);
    const aspect = bw === 0 || bh === 0 ? 0 : Math.min(bw, bh) / Math.max(bw, bh);
    const score = Math.min(0.95, 0.4 + aspect * 0.4 + Math.min(count, 20) / 40);
    if (aspect < 0.4) return null; // too elongated to be a ball — likely motion blur streak from bat/arm

    return { x: cx, y: cy, r, score };
  }

  function getBackend() {
    return backend;
  }

  function reset() {
    prevGray = null;
  }

  return { init, detect, getBackend, reset };
})();
