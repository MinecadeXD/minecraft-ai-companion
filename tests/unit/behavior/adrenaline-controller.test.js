import { describe, it, expect, beforeEach } from 'vitest';
import { AdrenalineController } from '../../../src/behavior/adrenaline-controller.js';

describe('AdrenalineController — arousal physiology and the Yerkes–Dodson law', () => {
  let adrenaline;

  beforeEach(() => {
    adrenaline = new AdrenalineController({ baseline: 0.1, calmWindowMs: 50, decayRatePerSec: 0.5 });
  });

  it('initializes in a resting/low-arousal state', () => {
    expect(adrenaline.adrenaline).toBeCloseTo(0.1, 2);
    expect(adrenaline.heartRateBpm).toBe(72);
    expect(adrenaline.isSluggish()).toBe(true);
    expect(adrenaline.isPanicking()).toBe(false);
    expect(adrenaline.isFlowState()).toBe(false);
  });

  it('increases adrenaline and heart rate when taking damage or facing danger', () => {
    adrenaline.triggerDamage(6);
    expect(adrenaline.adrenaline).toBeGreaterThan(0.3);
    adrenaline.update(100);
    expect(adrenaline.heartRateBpm).toBeGreaterThan(75);
  });

  it('adrenaline spike from a Creeper hiss depends on proximity', () => {
    adrenaline.triggerCreeperHiss(2.0); // nearby
    expect(adrenaline.adrenaline).toBeGreaterThan(0.4);
    expect(adrenaline.isFlowState() || adrenaline.isPanicking()).toBe(true);
  });

  it('implements the Yerkes–Dodson law with an optimum in the 0.35–0.55 range', () => {
    // At rest (0.1), performance is below optimal
    adrenaline.adrenaline = 0.1;
    const effRest = adrenaline.getYerkesDodsonEfficiency();

    // At the optimum (0.45), performance is highest
    adrenaline.adrenaline = 0.45;
    const effFlow = adrenaline.getYerkesDodsonEfficiency();
    expect(effFlow).toBeCloseTo(1.0, 1);
    expect(effFlow).toBeGreaterThan(effRest);

    // During panic (0.9), performance drops again
    adrenaline.adrenaline = 0.9;
    const effPanic = adrenaline.getYerkesDodsonEfficiency();
    expect(effPanic).toBeLessThan(effFlow);
    expect(adrenaline.isPanicking()).toBe(true);
  });

  it('calculates hand tremor and tunnel vision during panic', () => {
    adrenaline.adrenaline = 0.45;
    expect(adrenaline.getTremorMultiplier()).toBe(0.75); // hands are steady when calm
    expect(adrenaline.getAttentionTunnelingFactor()).toBe(0.0);

    adrenaline.adrenaline = 0.85;
    expect(adrenaline.getTremorMultiplier()).toBeGreaterThan(1.8); // panic-induced tremor
    expect(adrenaline.getAttentionTunnelingFactor()).toBeGreaterThan(0.4); // tunnel vision
  });
});
