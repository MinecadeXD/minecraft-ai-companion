import { createLogger } from '../utils/logger.js';
import { adaptiveCamera } from './adaptive-camera.js';
import { HumanErrorEngine } from './human-error-engine.js';

const logger = createLogger('FIDGET_CONTROLLER');

/**
 * FidgetController — maintains a sense of presence through small movements during AI delays (anti-AFK latency fidgeting):
 * While Gemini thinks about a response or calls tools (1–2 seconds):
 * 1. Naturally look toward the speaking player if they are within 8 blocks.
 * 2. Make tiny, natural gaze adjustments (±2–3 degrees, like breathing or a hand resting on a mouse pad).
 * 3. Make a small weight shift (a single sneak tap) if the wait becomes prolonged.
 * 4. Immediately return control to the script when thinking finishes.
 */
export class FidgetController {
  constructor(options = {}) {
    this.options = options;
    this.isThinking = false;
    this.interval = null;
    this.thinkingStartTime = 0;
    this.bot = null;
  }

  setBot(bot) {
    this.bot = bot;
  }

  startThinking(bot = null) {
    if (bot) this.bot = bot;
    if (!this.bot || this.isThinking) return;
    this.isThinking = true;
    this.thinkingStartTime = Date.now();

    this.interval = setInterval(() => {
      this._fidgetTick();
    }, 450);
  }

  stopThinking() {
    this.isThinking = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.bot?.setControlState) {
      try { this.bot.setControlState('sneak', false); } catch (_) {}
    }
  }

  async _fidgetTick() {
    if (!this.isThinking || !this.bot?.entity?.position) return;

    try {
      const now = Date.now();
      const elapsed = now - this.thinkingStartTime;

      // 1. Find the nearest live player within 8 blocks.
      let nearestPlayer = null;
      let minDistance = 8.0;

      const myPos = this.bot.entity.position;
      const entities = Object.values(this.bot.entities || {});

      for (const entity of entities) {
        if (!entity || entity === this.bot.entity || entity.type !== 'player' || !entity.position) continue;
        const dist = myPos.distanceTo(entity.position);
        if (dist < minDistance) {
          minDistance = dist;
          nearestPlayer = entity;
        }
      }

      if (nearestPlayer) {
        // Smoothly turn the view toward the player's head.
        const headPos = nearestPlayer.position.offset(0, nearestPlayer.height || 1.6, 0);
        await adaptiveCamera.calmLookAt(this.bot, headPos);
      } else {
        // Make a tiny gaze movement (like breathing or a relaxed hand movement).
        const currentYaw = this.bot.entity.yaw ?? 0;
        const currentPitch = this.bot.entity.pitch ?? 0;
        const dYaw = HumanErrorEngine.jitter(0.025, this.bot);
        const dPitch = HumanErrorEngine.jitter(0.02, this.bot);
        if (typeof this.bot.look === 'function') {
          await this.bot.look(currentYaw + dYaw, currentPitch + dPitch, true);
        }
      }

      // 2. If thinking takes longer than 1,800 ms, make one small weight shift (sneak tap).
      if (elapsed > 1800 && elapsed < 2500 && HumanErrorEngine.chance(0.35, this.bot)) {
        if (typeof this.bot.setControlState === 'function') {
          this.bot.setControlState('sneak', true);
          const tapMs = Math.round(HumanErrorEngine.range(100, 140, this.bot));
          setTimeout(() => {
            if (this.isThinking && typeof this.bot?.setControlState === 'function') {
              this.bot.setControlState('sneak', false);
            }
          }, tapMs);
        }
      }
    } catch (_) {}
  }
}

export const fidgetController = new FidgetController();
