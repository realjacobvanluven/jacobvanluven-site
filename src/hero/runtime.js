import { createSkylineScene, TIER_ORDER } from './scene.js';

/**
 * Runs the hero: render loop with adaptive quality, pausing, and an idle frame cap.
 *
 * - Adaptive quality: after a short warm-up, measure the frame rate for ~2 s; if it's below target,
 *   drop one tier (high → medium → low) and measure again.
 * - Pause when the hero is scrolled off-screen or the tab is hidden.
 * - Phones: 30 fps while idle, full rate for a moment after any interaction (pointer, touch, scroll, tilt).
 */
export async function startHero({ canvas, container = canvas, layout, dataUrl, onTierChange, onFrame } = {}) {
  const isPhone = layout === 'phone';
  const rect = container.getBoundingClientRect();
  const hero = await createSkylineScene({ canvas, width: Math.round(rect.width), height: Math.round(rect.height), layout, dataUrl });

  const TARGET_FPS = 60;
  const IDLE_FPS = isPhone ? 30 : 60;
  const INTERACTION_HOLD_MS = 1500;
  const WARMUP_MS = 500, MEASURE_MS = 2000;

  let visible = true, pageVisible = !document.hidden, running = false, raf = 0;
  let lastFrame = 0, lastInteraction = -Infinity;
  let measureStart = 0, measureFrames = 0, measuring = true, warmupUntil = 0;
  const start = performance.now();

  const markInteraction = () => { lastInteraction = performance.now(); };
  for (const type of ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown']) {
    window.addEventListener(type, markInteraction, { passive: true });
  }
  window.addEventListener('deviceorientation', markInteraction, { passive: true });

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const interacting = now - lastInteraction < INTERACTION_HOLD_MS;
    const fpsCap = interacting || measuring ? TARGET_FPS : IDLE_FPS;
    // Allow a little slack so a 60 Hz display still hits a 30 fps cap every other frame.
    if (now - lastFrame < 1000 / fpsCap - 2) return;
    lastFrame = now;
    onFrame?.(hero, now);
    hero.render((now - start) / 1000);

    if (!measuring) return;
    if (now < warmupUntil) return;
    if (!measureStart) { measureStart = now; measureFrames = 0; return; }
    measureFrames++;
    if (now - measureStart >= MEASURE_MS) {
      const fps = (measureFrames * 1000) / (now - measureStart);
      const i = TIER_ORDER.indexOf(hero.tier);
      if (fps < TARGET_FPS * 0.85 && i < TIER_ORDER.length - 1) {
        hero.setTier(TIER_ORDER[i + 1]);
        onTierChange?.(hero.tier, fps);
        measureStart = 0;
        warmupUntil = now + WARMUP_MS;
      } else {
        measuring = false;
        onTierChange?.(hero.tier, fps);
      }
    }
  }

  function update() {
    const shouldRun = visible && pageVisible;
    if (shouldRun && !running) {
      running = true;
      lastFrame = 0;
      if (measuring) { measureStart = 0; warmupUntil = performance.now() + WARMUP_MS; }
      raf = requestAnimationFrame(frame);
    } else if (!shouldRun && running) {
      running = false;
      cancelAnimationFrame(raf);
    }
  }

  // Follow the container's size (rotation, window resize).
  const ro = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) hero.setSize(Math.round(width), Math.round(height));
  });
  ro.observe(container);

  const io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; update(); });
  io.observe(container);
  const onVisibility = () => { pageVisible = !document.hidden; update(); };
  document.addEventListener('visibilitychange', onVisibility);
  warmupUntil = performance.now() + WARMUP_MS;
  update();

  return {
    hero,
    /** Keep full frame rate for a moment (e.g. during a camera animation). */
    poke: markInteraction,
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      for (const type of ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'scroll', 'keydown', 'deviceorientation']) {
        window.removeEventListener(type, markInteraction);
      }
    },
  };
}
