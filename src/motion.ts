// ============================================================
// MOTION — layer di interaction/motion per Galaxy Graph.
// Nessun framework: easing puri + uno stato minimo letto dal
// render loop ESISTENTE (nessun secondo requestAnimationFrame).
// Zero allocazioni per frame (endpoint come numeri flat).
// ============================================================

export const TOGGLE_KEYS = [
  "animations",
  "animFocus",
  "animPulse",
  "animReveal",
  "animIntro",
] as const;
export type ToggleKey = (typeof TOGGLE_KEYS)[number];

export const SLIDER_KEYS = [
  "bloom",
  "spread",
  "linkOpacity",
  "fog",
  "nebula",
  "stars",
  "animIntensity",
] as const;
export type SliderKey = (typeof SLIDER_KEYS)[number];

export interface MotionToggles {
  animations: boolean;
  animFocus: boolean;
  animPulse: boolean;
  animReveal: boolean;
  animIntro: boolean;
}

export const MOTION_DEFAULTS: MotionToggles & { animIntensity: number } = {
  animations: true,
  animFocus: true,
  animPulse: true,
  animReveal: true,
  animIntro: true,
  animIntensity: 1,
};

// Durate base (ms) — scalate da animIntensity (0.5–1.5).
export const FOCUS_DURATION = 620; // range richiesto 550–700
export const FOCUS_DURATION_REDUCED = 100; // reduced-motion: quasi istantaneo
export const PULSE_DURATION = 450;
export const PULSE_GAIN = 0.06; // 1.00 → 1.06 → 1.00
export const REVEAL_DURATION = 350; // range richiesto 250–450
export const INTRO_DURATION = 1000; // desktop, range 900–1200
export const INTRO_DURATION_COARSE = 450; // mobile/coarse: dimezzata
export const INTRO_PULLBACK = 1.14; // solo dolly, nessuna orbita

export function clamp(x: number, min: number, max: number): number {
  return x < min ? min : x > max ? max : x;
}

export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return 1 - Math.pow(1 - x, 3);
}

/**
 * Stati (massimo: cameraTween + kind, selectionStartTime,
 * linkRevealStartTime, introTween = cameraTween con kind "intro").
 * Scritti solo quando parte/finisce un'animazione.
 */
export class MotionState {
  camActive = false;
  camKind: "focus" | "intro" = "focus";
  camStart = 0;
  camDur = 0;
  // Endpoint come scalari: niente Vector3 temporanei per frame.
  fromX = 0;
  fromY = 0;
  fromZ = 0;
  fromTX = 0;
  fromTY = 0;
  fromTZ = 0;
  toX = 0;
  toY = 0;
  toZ = 0;
  toTX = 0;
  toTY = 0;
  toTZ = 0;

  pulseStart = -1; // one-shot sul selected (-1 = spento)
  revealActive = false;
  revealStart = 0;
  revealDur = 0;

  cancelCamera(): void {
    this.camActive = false;
  }

  reset(): void {
    this.camActive = false;
    this.pulseStart = -1;
    this.revealActive = false;
  }
}
