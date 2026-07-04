/**
 * tracker.js — Only tracking.
 * A small constant-velocity Kalman filter over [x, y, vx, vy]. Detector
 * output is noisy (especially the heuristic backend), so every accepted
 * detection is fed in as a measurement and the filter predicts through
 * frames where the detector misses.
 */
function KalmanBallTracker() {
  // State: [x, y, vx, vy]
  let x = [0, 0, 0, 0];
  let P = identity(4, 500); // high initial uncertainty
  let initialized = false;
  let lastTs = 0;

  const processNoise = 4; // how much we trust the constant-velocity model
  const measNoise = 6; // how much we trust a single detection

  function identity(n, scale = 1) {
    const m = [];
    for (let i = 0; i < n; i++) {
      m.push(Array.from({ length: n }, (_, j) => (i === j ? scale : 0)));
    }
    return m;
  }

  function predict(dt) {
    // x' = F x
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    x = matVec(F, x);
    // P' = F P F^T + Q
    const Q = identity(4, processNoise * dt);
    P = matAdd(matMul(matMul(F, P), transpose(F)), Q);
  }

  function update(zx, zy) {
    // Measurement model: we observe x, y directly
    const H = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ];
    const R = [
      [measNoise, 0],
      [0, measNoise],
    ];
    const z = [zx, zy];
    const y = vecSub(z, matVec(H, x));
    const S = matAdd(matMul(matMul(H, P), transpose(H)), R);
    const K = matMul(matMul(P, transpose(H)), inv2(S));
    x = vecAdd(x, matVec(K, y));
    const KH = matMul(K, H);
    const I = identity(4, 1);
    P = matMul(matSub(I, KH), P);
  }

  function step(measurement, timestampMs) {
    const ts = timestampMs || performance.now();
    const dt = initialized ? Math.min(0.12, (ts - lastTs) / 1000) : 0;
    lastTs = ts;

    if (!initialized) {
      if (!measurement) return null;
      x = [measurement.x, measurement.y, 0, 0];
      P = identity(4, 50);
      initialized = true;
      return { x: x[0], y: x[1], vx: 0, vy: 0 };
    }

    predict(dt || 0.016);
    if (measurement) update(measurement.x, measurement.y);

    return { x: x[0], y: x[1], vx: x[2], vy: x[3] };
  }

  function speedPxPerSec() {
    return Math.hypot(x[2], x[3]);
  }

  function reset() {
    initialized = false;
    x = [0, 0, 0, 0];
    P = identity(4, 500);
  }

  // ---- tiny linear algebra helpers (only what's needed for 4x4/2x2) ----
  function matVec(A, v) {
    return A.map((row) => row.reduce((s, a, j) => s + a * v[j], 0));
  }
  function matMul(A, B) {
    const rows = A.length, cols = B[0].length, inner = B.length;
    const out = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++)
        for (let k = 0; k < inner; k++) out[i][j] += A[i][k] * B[k][j];
    return out;
  }
  function transpose(A) {
    return A[0].map((_, j) => A.map((row) => row[j]));
  }
  function matAdd(A, B) {
    return A.map((row, i) => row.map((v, j) => v + B[i][j]));
  }
  function matSub(A, B) {
    return A.map((row, i) => row.map((v, j) => v - B[i][j]));
  }
  function vecAdd(a, b) {
    return a.map((v, i) => v + b[i]);
  }
  function vecSub(a, b) {
    return a.map((v, i) => v - b[i]);
  }
  function inv2(M) {
    const [[a, b], [c, d]] = M;
    const det = a * d - b * c || 1e-6;
    return [
      [d / det, -b / det],
      [-c / det, a / det],
    ];
  }

  return { step, speedPxPerSec, reset };
}

/**
 * BounceDetector — flags the frame where vertical velocity flips from
 * downward to upward, which is the pitch bounce point for a delivery.
 */
function BounceDetector() {
  let prevVy = null;
  let bouncePoint = null;

  function feed(state) {
    if (!state) return null;
    if (prevVy !== null && prevVy > 0 && state.vy < 0) {
      bouncePoint = { x: state.x, y: state.y };
      prevVy = state.vy;
      return bouncePoint;
    }
    prevVy = state.vy;
    return null;
  }

  function reset() {
    prevVy = null;
    bouncePoint = null;
  }

  function last() {
    return bouncePoint;
  }

  return { feed, reset, last };
}
