/**
 * rules.js — Only the decision engine.
 * Every function here is pure: geometry + detections in, a verdict out.
 * Calibration (from the Calibrate view) supplies the crease lines and
 * pitch width; detections come from Detector/Tracker for the current
 * delivery.
 *
 * Calibration shape expected (pixel coords in the *live* video frame):
 * {
 *   creaseNear:  {x,y}, creaseFar: {x,y},      // popping creases, bowler & striker end
 *   returnLeftNear:{x,y}, returnRightNear:{x,y}, // wide guides at striker's end
 *   stumpsFar: {x,y,width},                     // striker's stumps bounding box
 *   waistHeightFar: number,                     // y-pixel of batter's waist at striker's end
 * }
 */
const Rules = (() => {
  function verdictLegal() {
    return { legal: true, callouts: [] };
  }

  /**
   * Front-foot no-ball: bowler's front foot landing box must have some
   * part behind (on the bowler's side of) the popping crease line.
   * `footBox` is {x,y,w,h} from the detector at the moment of landing;
   * `creaseNearY` is the crease line's y-pixel at the bowler's end.
   */
  function checkFrontFootNoBall(footBox, calibration) {
    if (!footBox || !calibration || !calibration.creaseNear) return null;
    const footFrontEdgeY = footBox.y + footBox.h; // edge closest to the striker
    const overStepped = footFrontEdgeY > calibration.creaseNear.y + (calibration.creaseTolerancePx || 0);
    if (overStepped) {
      return { code: "noball_frontfoot", label: "No ball — front foot", legal: false };
    }
    return null;
  }

  /**
   * Height no-ball / waist-high full toss: ball crosses the striker's
   * batting crease above waist height without bouncing.
   */
  function checkHeightNoBall(trajectoryPoints, calibration) {
    if (!calibration || !calibration.waistHeightFar || trajectoryPoints.length < 2) return null;
    const far = calibration.creaseFar;
    if (!far) return null;
    // find the point where the ball crosses the striker's crease line (y >= far.y)
    for (let i = 1; i < trajectoryPoints.length; i++) {
      const a = trajectoryPoints[i - 1], b = trajectoryPoints[i];
      if (a.y < far.y && b.y >= far.y) {
        const t = (far.y - a.y) / (b.y - a.y || 1);
        const crossY = a.y + (b.y - a.y) * t;
        const crossHeightPx = far.y - crossY; // not used directly; we compare against waist line
        if (crossY < calibration.waistHeightFar) {
          return { code: "noball_full_toss_waist", label: "No ball — waist height full toss", legal: false };
        }
      }
    }
    return null;
  }

  /**
   * Wide: ball passes the striker's popping crease outside the return-
   * crease guide lines and the batter did not/could not hit it.
   */
  function checkWide(trajectoryPoints, calibration, battingSide = "right") {
    if (!calibration || !calibration.returnLeftNear || !calibration.returnRightNear) return null;
    const far = calibration.creaseFar;
    if (!far || trajectoryPoints.length < 2) return null;
    for (let i = 1; i < trajectoryPoints.length; i++) {
      const a = trajectoryPoints[i - 1], b = trajectoryPoints[i];
      if (a.y < far.y && b.y >= far.y) {
        const t = (far.y - a.y) / (b.y - a.y || 1);
        const crossX = a.x + (b.x - a.x) * t;
        const left = calibration.returnLeftNear.x;
        const right = calibration.returnRightNear.x;
        if (crossX < left) {
          return { code: "wide_off", label: battingSide === "right" ? "Wide — off side" : "Wide — leg side", legal: false };
        }
        if (crossX > right) {
          return { code: "wide_leg", label: battingSide === "right" ? "Wide — leg side" : "Wide — off side", legal: false };
        }
      }
    }
    return null;
  }

  /** Dead ball: ball stops/settles before reaching the striker, no contact detected. */
  function checkDeadBall(trajectoryPoints, calibration) {
    if (trajectoryPoints.length < 6) return null;
    const last6 = trajectoryPoints.slice(-6);
    const spread = Math.hypot(
      last6[5].x - last6[0].x,
      last6[5].y - last6[0].y
    );
    if (spread < 4 && calibration && calibration.creaseFar) {
      const reachedStriker = last6[5].y > calibration.creaseFar.y - 40;
      if (!reachedStriker) return { code: "dead_ball", label: "Dead ball", legal: true, dead: true };
    }
    return null;
  }

  /**
   * Runs the full pipeline for one delivery and returns the first
   * applicable verdict, in umpiring priority order: no-ball checks take
   * precedence over wide, and either overrides a plain legal delivery.
   * Callers should still allow the human scorer to override anything.
   */
  function evaluateDelivery({ footBox, trajectoryPoints, calibration, battingSide }) {
    const frontFoot = checkFrontFootNoBall(footBox, calibration);
    if (frontFoot) return frontFoot;

    const height = checkHeightNoBall(trajectoryPoints, calibration);
    if (height) return height;

    const wide = checkWide(trajectoryPoints, calibration, battingSide);
    if (wide) return wide;

    const dead = checkDeadBall(trajectoryPoints, calibration);
    if (dead) return dead;

    return { code: "legal", label: "Legal delivery", legal: true };
  }

  return {
    checkFrontFootNoBall,
    checkHeightNoBall,
    checkWide,
    checkDeadBall,
    evaluateDelivery,
  };
})();
