import logger from '../utils/logger.js';

export class SpatialIntelligence {
  /**
   * Determine relative direction from bot view orientation to target point.
   * @param {object} botPos - {x, y, z}
   * @param {number} botYaw - Radians
   * @param {object} targetPos - {x, y, z}
   * @returns {string} 'ahead' | 'behind' | 'left' | 'right' | 'above' | 'below'
   */
  getRelativeDirection(botPos, botYaw, targetPos) {
    if (!botPos || !targetPos) return 'unknown';

    const dx = targetPos.x - botPos.x;
    const dy = targetPos.y - botPos.y;
    const dz = targetPos.z - botPos.z;

    // Vertical dominance
    if (dy > 2.5) return 'above';
    if (dy < -2.5) return 'below';

    // Horizontal angle relative to yaw
    const angleToTarget = Math.atan2(-dx, -dz);
    let diff = angleToTarget - botYaw;
    while (diff < -Math.PI) diff += Math.PI * 2;
    while (diff > Math.PI) diff -= Math.PI * 2;

    const deg = (diff * 180) / Math.PI;

    if (Math.abs(deg) <= 45) return 'ahead';
    if (deg > 45 && deg < 135) return 'left';
    if (deg < -45 && deg > -135) return 'right';
    return 'behind';
  }

  /**
   * Describe relative position in natural English.
   */
  describeRelativePosition(botPos, botYaw, targetPos) {
    const dir = this.getRelativeDirection(botPos, botYaw, targetPos);
    const dist = Math.round(Math.hypot(targetPos.x - botPos.x, targetPos.y - botPos.y, targetPos.z - botPos.z));

    const names = {
      ahead: 'ahead of you',
      behind: 'behind you',
      left: 'to your left',
      right: 'to your right',
      above: 'above you',
      below: 'below you',
    };

    return `${names[dir] || dir} (about ${dist} blocks away)`;
  }

  /**
   * Compass direction the bot is currently facing based on yaw.
   * Minecraft/mineflayer yaw: view vector is (-sin yaw, -cos yaw), so
   * yaw 0 = facing NORTH (-Z), PI = south (+Z), PI/2 = east... see ray_trace.
   * @param {number} yaw - Radians
   * @returns {{ code: string, en: string }}
   */
  getFacingDirection(yaw) {
    // Match mineflayer's own look-direction math: x = -sin(yaw), z = -cos(yaw).
    return this.compassFromVector(-Math.sin(yaw), -Math.cos(yaw));
  }

  /**
   * Compass direction (8-wind) from a horizontal (dx, dz) vector.
   * Uses Minecraft axes: +X = east, +Z = south.
   * @returns {{ code: string, ru: string }}
   */
  compassFromVector(dx, dz) {
    const codes = ['S', 'SE', 'E', 'NE', 'N', 'NW', 'W', 'SW'];
    const enNames = {
      N: 'north', NE: 'northeast', E: 'east', SE: 'southeast',
      S: 'south', SW: 'southwest', W: 'west', NW: 'northwest',
    };
    if ((dx === 0 && dz === 0) || !Number.isFinite(dx) || !Number.isFinite(dz)) {
      return { code: 'N', en: enNames.N };
    }
    // atan2(dx, dz): 0 = +Z (south), matches Minecraft yaw convention.
    const angle = Math.atan2(dx, dz);
    let index = Math.round(((angle + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8;
    const code = codes[index];
    return { code, en: enNames[code] };
  }

  /**
   * Compass direction from bot position toward a target point.
   * @returns {{ code: string, ru: string }}
   */
  getCompassToTarget(botPos, targetPos) {
    if (!botPos || !targetPos) return { code: 'N', en: 'north' };
    return this.compassFromVector(targetPos.x - botPos.x, targetPos.z - botPos.z);
  }

  /**
   * Full human description, for example: "a village to the northeast, about 120 blocks away, to your right".
   */
  describeTarget(botPos, botYaw, targetPos, label = 'target') {
    if (!botPos || !targetPos) return `${label}: position unknown`;
    const compass = this.getCompassToTarget(botPos, targetPos);
    const rel = this.describeRelativePosition(botPos, botYaw, targetPos);
    return `${label} to the ${compass.en}, ${rel}`;
  }
}

export const spatialIntelligence = new SpatialIntelligence();
