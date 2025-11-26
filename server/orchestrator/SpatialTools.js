/**
 * SpatialTools - Handles all geometry and spatial reasoning
 *
 * CLU describes INTENT, these tools handle the MATH.
 * This lets LLMs do what they're good at (creativity, planning)
 * while code handles what they're bad at (coordinates, collision).
 */

export class SpatialTools {
  constructor(worldState) {
    this.worldState = worldState;
    this.gridSize = 5; // Abstract grid cell size for CLU's mental map
  }

  /**
   * Convert world coordinates to grid coordinates for CLU
   * CLU thinks in terms of "A1, B2" etc, not "x: 23.5, z: -17.2"
   */
  worldToGrid(x, z) {
    const gridX = Math.floor(x / this.gridSize);
    const gridZ = Math.floor(z / this.gridSize);
    const col = String.fromCharCode(65 + ((gridX + 10) % 26)); // A-Z
    const row = gridZ + 10; // Offset to avoid negatives
    return `${col}${row}`;
  }

  gridToWorld(gridRef) {
    const col = gridRef.charCodeAt(0) - 65;
    const row = parseInt(gridRef.slice(1));
    return {
      x: (col - 10) * this.gridSize + this.gridSize / 2,
      z: (row - 10) * this.gridSize + this.gridSize / 2
    };
  }

  /**
   * Find empty space near a location
   * CLU says "find space near center", this returns actual coordinates
   */
  findEmptySpace(options = {}) {
    const {
      near = { x: 0, z: 0 },
      size = 1,
      minDistance = 5,
      maxDistance = 30
    } = options;

    // Get all occupied positions
    const residents = this.worldState.getAllResidents();
    const structures = this.getStructuresNear(near.x, near.z, maxDistance);

    // Spiral search for empty space
    for (let distance = minDistance; distance <= maxDistance; distance += this.gridSize) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = near.x + Math.cos(angle) * distance;
        const z = near.z + Math.sin(angle) * distance;

        if (this.isSpaceClear(x, z, size, residents, structures)) {
          return { x, y: 0, z, gridRef: this.worldToGrid(x, z) };
        }
      }
    }

    return null; // No space found
  }

  isSpaceClear(x, z, size, residents, structures) {
    const minDist = size * this.gridSize;

    // Check residents
    for (const r of residents) {
      const dist = Math.sqrt(
        Math.pow(r.position.x - x, 2) +
        Math.pow(r.position.z - z, 2)
      );
      if (dist < minDist) return false;
    }

    // Check structures
    for (const s of structures) {
      const dist = Math.sqrt(
        Math.pow(s.x - x, 2) +
        Math.pow(s.z - z, 2)
      );
      if (dist < minDist) return false;
    }

    return true;
  }

  getStructuresNear(x, z, radius) {
    // Query structures table within radius
    try {
      const stmt = this.worldState.db.prepare(`
        SELECT * FROM structures
        WHERE (x - ?)*(x - ?) + (z - ?)*(z - ?) <= ?*?
      `);
      return stmt.all(x, x, z, z, radius, radius).map(row => ({
        ...row,
        params: JSON.parse(row.params || '{}')
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * Get what's near a position - simplified for CLU
   */
  getNearby(position, radius = 20) {
    const residents = this.worldState.getResidentsInRadius(position.x, position.z, radius);
    const structures = this.getStructuresNear(position.x, position.z, radius);

    return {
      residents: residents.map(r => ({
        id: r.id,
        name: r.soul_card.name,
        gridRef: this.worldToGrid(r.position.x, r.position.z),
        distance: Math.round(Math.sqrt(
          Math.pow(r.position.x - position.x, 2) +
          Math.pow(r.position.z - position.z, 2)
        )),
        state: r.state
      })),
      structures: structures.map(s => ({
        id: s.id,
        type: s.type,
        gridRef: this.worldToGrid(s.x, s.z),
        distance: Math.round(Math.sqrt(
          Math.pow(s.x - position.x, 2) +
          Math.pow(s.z - position.z, 2)
        ))
      }))
    };
  }

  /**
   * Calculate path between two points (simple for now)
   */
  getPath(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dz * dz);

    // Primary direction
    let direction;
    if (Math.abs(dx) > Math.abs(dz)) {
      direction = dx > 0 ? 'east' : 'west';
    } else {
      direction = dz > 0 ? 'south' : 'north';
    }

    return {
      direction,
      distance: Math.round(distance),
      steps: Math.ceil(distance / this.gridSize)
    };
  }

  /**
   * Validate a placement request
   */
  validatePlacement(type, position, size = 1) {
    const residents = this.worldState.getAllResidents();
    const structures = this.getStructuresNear(position.x, position.z, size * this.gridSize * 2);

    const clear = this.isSpaceClear(position.x, position.z, size, residents, structures);

    return {
      valid: clear,
      position: position,
      gridRef: this.worldToGrid(position.x, position.z),
      reason: clear ? 'Space is clear' : 'Space is occupied'
    };
  }

  /**
   * Generate a simplified map for CLU
   * Returns a text-based representation of the world
   */
  generateMap(center = { x: 0, z: 0 }, radius = 5) {
    const map = [];
    const residents = this.worldState.getAllResidents();
    const structures = this.getStructuresNear(center.x, center.z, radius * this.gridSize);

    // Build grid cells
    for (let gz = -radius; gz <= radius; gz++) {
      const row = [];
      for (let gx = -radius; gx <= radius; gx++) {
        const worldX = center.x + gx * this.gridSize;
        const worldZ = center.z + gz * this.gridSize;
        const gridRef = this.worldToGrid(worldX, worldZ);

        // Check what's in this cell
        const residentHere = residents.find(r =>
          Math.abs(r.position.x - worldX) < this.gridSize / 2 &&
          Math.abs(r.position.z - worldZ) < this.gridSize / 2
        );

        const structureHere = structures.find(s =>
          Math.abs(s.x - worldX) < this.gridSize / 2 &&
          Math.abs(s.z - worldZ) < this.gridSize / 2
        );

        if (residentHere) {
          row.push(`[${residentHere.soul_card.name.substring(0, 3)}]`);
        } else if (structureHere) {
          row.push(`{${structureHere.type.substring(0, 3)}}`.toUpperCase());
        } else if (gx === 0 && gz === 0) {
          row.push('  +  '); // Center marker
        } else {
          row.push('  .  ');
        }
      }
      map.push(row.join(''));
    }

    return map.join('\n');
  }

  /**
   * Structure templates - what can be built and their properties
   */
  getStructureTemplates() {
    return {
      beacon: {
        name: 'Beacon Tower',
        size: 1,
        description: 'A glowing pillar that attracts residents',
        effect: 'gather_point'
      },
      wall: {
        name: 'Energy Wall',
        size: 2,
        description: 'A barrier segment',
        effect: 'barrier'
      },
      platform: {
        name: 'Platform',
        size: 2,
        description: 'An elevated gathering space',
        effect: 'social_space'
      },
      obelisk: {
        name: 'Data Obelisk',
        size: 1,
        description: 'Stores memories and broadcasts information',
        effect: 'memory_store'
      },
      gateway: {
        name: 'Gateway',
        size: 3,
        description: 'A passage between distant points',
        effect: 'teleport'
      },
      arena: {
        name: 'Arena',
        size: 4,
        description: 'A circular space for gatherings or competitions',
        effect: 'event_space'
      }
    };
  }

  /**
   * Execute a build command from CLU
   * CLU says "build beacon near center", this makes it happen
   */
  executeBuild(type, location, builtBy = 'CLU') {
    const templates = this.getStructureTemplates();
    const template = templates[type];

    if (!template) {
      return { success: false, error: `Unknown structure type: ${type}` };
    }

    // Resolve location
    let position;
    if (typeof location === 'string') {
      // Grid reference like "K10"
      position = this.gridToWorld(location);
    } else if (location.near) {
      // Find space near something
      position = this.findEmptySpace({
        near: location.near,
        size: template.size
      });
      if (!position) {
        return { success: false, error: 'No empty space found' };
      }
    } else {
      position = location;
    }

    // Validate
    const validation = this.validatePlacement(type, position, template.size);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // Build it
    const structureId = this.worldState.addStructure(
      type,
      position.x,
      0,
      position.z,
      { template: type, ...template },
      builtBy
    );

    return {
      success: true,
      structureId,
      type,
      position,
      gridRef: this.worldToGrid(position.x, position.z),
      template
    };
  }
}

export default SpatialTools;
