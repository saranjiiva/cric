/**
 * trajectory.js — Only trajectory.
 * Accumulates the tracked ball's positions for one delivery and derives
 * human-readable numbers (speed in km/h, pitching point) from the pixel
 * coordinates using the calibration saved by Settings/Calibration.
 */
const Trajectory = (() => {
  const PITCH_LENGTH_M = 20.12; // popping crease to popping crease

  let points = []; // {x,y,t}
  let pxPerMeter = null;

  function setCalibration(calibration) {
    // calibration.creaseNear / creaseFar are {x,y} in video pixel space
    if (calibration && calibration.creaseNear && calibration.creaseFar) {
      const dx = calibration.creaseFar.x - calibration.creaseNear.x;
      const dy = calibration.creaseFar.y - calibration.creaseNear.y;
      const pixelLength = Math.hypot(dx, dy);
      pxPerMeter = pixelLength / PITCH_LENGTH_M;
    } else {
      pxPerMeter = null;
    }
  }

  function reset() {
    points = [];
  }

  function addPoint(x, y, t) {
    points.push({ x, y, t: t || performance.now() });
    if (points.length > 240) points.shift();
  }

  function getPoints() {
    return points;
  }

  /** Instantaneous speed in km/h from the last two recorded points. */
  function currentSpeedKmh() {
    if (points.length < 2 || !pxPerMeter) return null;
    const a = points[points.length - 2];
    const b = points[points.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return null;
    const distPx = Math.hypot(b.x - a.x, b.y - a.y);
    const distM = distPx / pxPerMeter;
    const mps = distM / dt;
    return mps * 3.6;
  }

  /** Peak speed over the whole recorded delivery. */
  function peakSpeedKmh() {
    if (!pxPerMeter || points.length < 2) return null;
    let peak = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dt = (b.t - a.t) / 1000;
      if (dt <= 0) continue;
      const distM = Math.hypot(b.x - a.x, b.y - a.y) / pxPerMeter;
      peak = Math.max(peak, (distM / dt) * 3.6);
    }
    return peak;
  }

  function hasCalibration() {
    return !!pxPerMeter;
  }

  return {
    setCalibration,
    reset,
    addPoint,
    getPoints,
    currentSpeedKmh,
    peakSpeedKmh,
    hasCalibration,
  };
})();
