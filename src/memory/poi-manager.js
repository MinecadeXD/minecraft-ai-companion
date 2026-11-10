import { createLogger } from '../utils/logger.js';

const logger = createLogger('MEMORY');

export const POITypes = {
  BASE: 'base',
  VILLAGE: 'village',
  CAVE: 'cave',
  STRONGHOLD: 'stronghold',
  NETHER_FORTRESS: 'nether_fortress',
  PORTAL: 'portal',
  MINE: 'mine',
  FARM: 'farm',
  DEATH: 'death_location',
  OTHER: 'other',
};

export class POIManager {
  constructor(longTermMemory) {
    this.storage = longTermMemory;
  }

  /**
   * Add a new point of interest.
   */
  addPOI(name, type, { x, y, z }, notes = '', dimension = 'overworld') {
    const id = this.storage.addPOI(name, type, { x, y, z }, notes, dimension);
    logger.info(`Saved point of interest [${type}] "${name}" at [${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}]`);
    return { id, name, type, x, y, z, notes };
  }

  /**
   * Get all POIs of a specified type, or all POIs.
   */
  getPOIs(type = null) {
    return this.storage.getPOIs(type);
  }

  /**
   * Find a POI by name.
   */
  findByName(name) {
    return this.storage.getPOIByName(name);
  }

  /**
   * Find the nearest point of interest to a given position.
   */
  findNearest(pos, type = null) {
    const all = this.getPOIs(type);
    if (all.length === 0) return null;

    let nearest = null;
    let minDist = Infinity;

    for (const poi of all) {
      const dx = pos.x - poi.x;
      const dy = pos.y - poi.y;
      const dz = pos.z - poi.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < minDist) {
        minDist = dist;
        nearest = { ...poi, distance: Math.round(dist * 10) / 10 };
      }
    }

    return nearest;
  }

  /**
   * Return the base (if one is set).
   */
  getBase() {
    const bases = this.getPOIs(POITypes.BASE);
    return bases.length > 0 ? bases[0] : null;
  }

  /**
   * Set or update the main base.
   */
  setBase(pos, name = 'Main Base', notes = 'Our base') {
    return this.addPOI(name, POITypes.BASE, pos, notes);
  }
}
