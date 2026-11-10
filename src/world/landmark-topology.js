import { createLogger } from '../utils/logger.js';
import { spatialIntelligence } from './spatial-intelligence.js';

const logger = createLogger('LANDMARK_TOPOLOGY');

/**
 * LandmarkTopology — human-like spatial memory based on landmarks:
 * People do not think "go to x: 124, y: 64, z: -289."
 * They think "by the old oak," "in the chest to the right of the furnace," or "in the mine beyond the river to the north."
 */
export class LandmarkTopology {
  constructor() {
    this.landmarks = new Map(); // name -> { name, coords, description, landmarkType, createdAt }
  }

  /**
   * Remember a landmark
   */
  remember(name, coords, description = '', landmarkType = 'landmark') {
    if (!name || !coords) return null;
    const cleanName = String(name).trim();
    const entry = {
      name: cleanName,
      coords: {
        x: Math.round(coords.x),
        y: Math.round(coords.y),
        z: Math.round(coords.z),
      },
      description,
      landmarkType,
      createdAt: Date.now(),
    };
    this.landmarks.set(cleanName.toLowerCase(), entry);
    logger.info(`[LANDMARK] Remembered landmark: "${cleanName}" at [${entry.coords.x}, ${entry.coords.y}, ${entry.coords.z}] (${description})`);
    return entry;
  }

  /**
   * Find a landmark by name
   */
  get(name) {
    if (!name) return null;
    return this.landmarks.get(String(name).toLowerCase()) || null;
  }

  /**
   * Find the nearest landmark to a given point
   */
  findNearest(pos, type = null) {
    if (!pos) return null;
    let best = null;
    let minDistance = Infinity;

    for (const [_, entry] of this.landmarks) {
      if (type && entry.landmarkType !== type) continue;
      const dist = Math.hypot(pos.x - entry.coords.x, pos.y - entry.coords.y, pos.z - entry.coords.z);
      if (dist < minDistance) {
        minDistance = dist;
        best = { ...entry, distance: Math.round(dist) };
      }
    }
    return best;
  }

  /**
   * Human-like topological description of a position relative to known landmarks
   */
  describeRelative(pos, botYaw = 0) {
    if (!pos) return 'unknown location';
    const nearest = this.findNearest(pos);
    if (!nearest) return `[${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}]`;

    if (nearest.distance <= 3) {
      return `right by the landmark "${nearest.name}"`;
    }

    const direction = spatialIntelligence?.describeRelativePosition
      ? spatialIntelligence.describeRelativePosition(nearest.coords, botYaw, pos)
      : `${nearest.distance} m`;

    return `near "${nearest.name}" (${direction})`;
  }

  /**
   * List all active landmarks for Gemini context
   */
  list() {
    return Array.from(this.landmarks.values());
  }
}

export const landmarkTopology = new LandmarkTopology();
