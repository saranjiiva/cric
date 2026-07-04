/**
 * camera.js — Only camera.
 * Wraps getUserMedia so the rest of the app never touches MediaDevices
 * directly. Handles rear-camera selection, digital+optical zoom (where
 * the hardware exposes it), torch, and requesting the highest
 * resolution/frame-rate the device will give us.
 */
const Camera = (() => {
  let stream = null;
  let track = null;
  let videoEl = null;
  let capabilities = null;
  let zoomLevel = 1;

  async function start(videoElement, { facingMode = "environment" } = {}) {
    videoEl = videoElement;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Camera API not available in this browser.");
    }

    const constraints = {
      audio: false,
      video: {
        facingMode: { ideal: facingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 60, min: 30 },
      },
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    track = stream.getVideoTracks()[0];
    videoEl.srcObject = stream;
    await videoEl.play().catch(() => {});

    capabilities = track.getCapabilities ? track.getCapabilities() : {};
    if (capabilities.zoom) {
      zoomLevel = track.getSettings().zoom || capabilities.zoom.min || 1;
    }
    return { capabilities, settings: track.getSettings ? track.getSettings() : {} };
  }

  function stop() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    stream = null;
    track = null;
  }

  function hasTorch() {
    return !!(capabilities && capabilities.torch);
  }

  async function setTorch(on) {
    if (!track || !hasTorch()) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: !!on }] });
      return true;
    } catch (err) {
      console.warn("[camera] torch failed", err);
      return false;
    }
  }

  function zoomRange() {
    if (!capabilities || !capabilities.zoom) return null;
    return capabilities.zoom; // {min, max, step}
  }

  async function setZoom(level) {
    const range = zoomRange();
    if (!track) return zoomLevel;
    if (range) {
      const clamped = Math.min(range.max, Math.max(range.min, level));
      try {
        await track.applyConstraints({ advanced: [{ zoom: clamped }] });
        zoomLevel = clamped;
      } catch (err) {
        console.warn("[camera] hardware zoom failed, falling back to CSS zoom", err);
        zoomLevel = level; // caller can apply a CSS transform as a fallback
      }
    } else {
      // No native zoom capability — caller should apply a CSS scale to
      // the <video> as a digital-zoom fallback.
      zoomLevel = level;
    }
    return zoomLevel;
  }

  function getZoom() {
    return zoomLevel;
  }

  function currentTrackSettings() {
    return track && track.getSettings ? track.getSettings() : {};
  }

  return {
    start,
    stop,
    hasTorch,
    setTorch,
    zoomRange,
    setZoom,
    getZoom,
    currentTrackSettings,
  };
})();
