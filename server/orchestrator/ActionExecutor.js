/**
 * ActionExecutor - Translates CLU's intent into world changes
 *
 * CLU says: "Build a beacon near the center"
 * ActionExecutor:
 *   1. Uses SpatialTools to find a good spot
 *   2. Creates the structure in WorldState
 *   3. Broadcasts the change to clients
 *   4. Reports success/failure back
 */

export class ActionExecutor {
  constructor(worldState, spatialTools, broadcast) {
    this.worldState = worldState;
    this.spatialTools = spatialTools;
    this.broadcast = broadcast; // Function to send updates to WebSocket clients
  }

  /**
   * Execute an action from CLU
   */
  async execute(action) {
    if (!action || !action.action) {
      return { success: false, error: 'No action specified' };
    }

    console.log(`[ActionExecutor] Executing: ${action.action}`, action.params || {});

    switch (action.action) {
      case 'build':
        return this.executeBuild(action.params);

      case 'instruct':
        return this.executeInstruct(action.params);

      case 'gather':
        return this.executeGather(action.params);

      case 'announce':
        return this.executeAnnounce(action.params);

      case 'spawn':
        return this.executeSpawn(action.params);

      case 'move_resident':
        return this.executeMoveResident(action.params);

      default:
        console.warn(`[ActionExecutor] Unknown action: ${action.action}`);
        return { success: false, error: `Unknown action: ${action.action}` };
    }
  }

  /**
   * Build a structure
   */
  executeBuild(params) {
    const { type, location, near } = params || {};

    if (!type) {
      return { success: false, error: 'No structure type specified' };
    }

    // Resolve location
    let buildLocation;
    if (location) {
      // Specific grid reference or coordinates
      if (typeof location === 'string') {
        buildLocation = location;
      } else {
        buildLocation = location;
      }
    } else if (near) {
      // Find space near something
      buildLocation = { near: this.resolveNear(near) };
    } else {
      // Default: near center
      buildLocation = { near: { x: 0, z: 0 } };
    }

    // Use SpatialTools to build
    const result = this.spatialTools.executeBuild(type, buildLocation, 'CLU');

    if (result.success) {
      // Log event
      this.worldState.logEvent('structure_built', {
        type,
        position: result.position,
        gridRef: result.gridRef,
        builtBy: 'CLU'
      });

      // Broadcast to clients
      this.broadcast({
        type: 'structure_built',
        data: {
          id: result.structureId,
          structureType: type,
          position: result.position,
          gridRef: result.gridRef,
          template: result.template
        }
      });

      console.log(`[ActionExecutor] Built ${type} at ${result.gridRef}`);
    }

    return result;
  }

  /**
   * Instruct a resident to do something
   * This queues the instruction for when the resident's turn comes
   */
  executeInstruct(params) {
    const { residentName, residentId, instruction } = params || {};

    // Find resident by name or ID
    let resident;
    if (residentId) {
      resident = this.worldState.getResident(residentId);
    } else if (residentName) {
      const all = this.worldState.getAllResidents();
      resident = all.find(r =>
        r.soul_card.name.toLowerCase().includes(residentName.toLowerCase())
      );
    }

    if (!resident) {
      return { success: false, error: `Resident not found: ${residentName || residentId}` };
    }

    // Log the directive
    this.worldState.logEvent('resident_directive', {
      residentId: resident.id,
      residentName: resident.soul_card.name,
      instruction,
      from: 'CLU'
    });

    // Broadcast
    this.broadcast({
      type: 'clu_directive',
      data: {
        residentId: resident.id,
        residentName: resident.soul_card.name,
        instruction
      }
    });

    console.log(`[ActionExecutor] Instructed ${resident.soul_card.name}: ${instruction}`);

    return {
      success: true,
      residentId: resident.id,
      residentName: resident.soul_card.name,
      instruction
    };
  }

  /**
   * Gather residents to a location
   */
  executeGather(params) {
    const { location, near } = params || {};

    // Resolve target location
    let target;
    if (location) {
      if (typeof location === 'string') {
        target = this.spatialTools.gridToWorld(location);
      } else {
        target = location;
      }
    } else if (near) {
      target = this.resolveNear(near);
    } else {
      target = { x: 0, z: 0 };
    }

    // Get all residents and move them toward target
    const residents = this.worldState.getAllResidents();
    const moved = [];

    for (const resident of residents) {
      const path = this.spatialTools.getPath(resident.position, target);

      // Move them partway (not instant teleport)
      const moveDistance = Math.min(path.distance, 5); // Max 5 units per gather call
      const newPos = this.worldState.moveResident(resident.id, {
        direction: path.direction,
        distance: moveDistance
      });

      if (newPos) {
        moved.push({
          id: resident.id,
          name: resident.soul_card.name,
          newPosition: newPos,
          direction: path.direction
        });
      }
    }

    // Log event
    this.worldState.logEvent('gather_command', {
      target,
      residentsAffected: moved.length
    });

    // Broadcast movements
    for (const m of moved) {
      this.broadcast({
        type: 'resident_moved',
        data: {
          id: m.id,
          position: m.newPosition,
          reason: 'gather_command'
        }
      });
    }

    // Broadcast the gather announcement
    this.broadcast({
      type: 'world_event',
      data: {
        type: 'clu_voice',
        message: `CLU calls all programs to assemble.`
      }
    });

    console.log(`[ActionExecutor] Gathered ${moved.length} residents toward ${target.x.toFixed(0)}, ${target.z.toFixed(0)}`);

    return {
      success: true,
      target,
      residentsAffected: moved.length,
      movements: moved
    };
  }

  /**
   * Announce a message to the Grid
   */
  executeAnnounce(params) {
    const { message } = params || {};

    if (!message) {
      return { success: false, error: 'No message to announce' };
    }

    // Log event
    this.worldState.logEvent('clu_announcement', { message });

    // Broadcast to all clients
    this.broadcast({
      type: 'world_event',
      data: {
        type: 'clu_voice',
        message: `CLU: ${message}`
      }
    });

    console.log(`[ActionExecutor] Announced: ${message}`);

    return { success: true, message };
  }

  /**
   * Spawn a new resident (delegates to SoulGenerator)
   */
  executeSpawn(params) {
    // This will be called by the main loop with a SoulGenerator
    return {
      success: true,
      action: 'spawn_queued',
      params
    };
  }

  /**
   * Move a specific resident
   */
  executeMoveResident(params) {
    const { residentId, residentName, direction, distance, to } = params || {};

    // Find resident
    let resident;
    if (residentId) {
      resident = this.worldState.getResident(residentId);
    } else if (residentName) {
      const all = this.worldState.getAllResidents();
      resident = all.find(r =>
        r.soul_card.name.toLowerCase().includes(residentName.toLowerCase())
      );
    }

    if (!resident) {
      return { success: false, error: `Resident not found` };
    }

    let newPos;
    if (to) {
      // Move to specific location
      const target = typeof to === 'string' ? this.spatialTools.gridToWorld(to) : to;
      const path = this.spatialTools.getPath(resident.position, target);
      newPos = this.worldState.moveResident(resident.id, {
        direction: path.direction,
        distance: Math.min(path.distance, distance || 10)
      });
    } else if (direction) {
      // Move in direction
      newPos = this.worldState.moveResident(resident.id, {
        direction,
        distance: distance || 3
      });
    }

    if (newPos) {
      this.broadcast({
        type: 'resident_moved',
        data: {
          id: resident.id,
          position: newPos,
          reason: 'clu_directive'
        }
      });

      return { success: true, residentId: resident.id, newPosition: newPos };
    }

    return { success: false, error: 'Failed to move resident' };
  }

  /**
   * Resolve "near" references like "center", "beacon", resident names
   */
  resolveNear(near) {
    if (typeof near === 'object' && 'x' in near) {
      return near;
    }

    const nearLower = near.toLowerCase();

    if (nearLower === 'center' || nearLower === 'origin') {
      return { x: 0, z: 0 };
    }

    // Check for resident by name
    const residents = this.worldState.getAllResidents();
    const resident = residents.find(r =>
      r.soul_card.name.toLowerCase().includes(nearLower)
    );
    if (resident) {
      return { x: resident.position.x, z: resident.position.z };
    }

    // Check for structure by type
    const structures = this.spatialTools.getStructuresNear(0, 0, 100);
    const structure = structures.find(s =>
      s.type.toLowerCase().includes(nearLower)
    );
    if (structure) {
      return { x: structure.x, z: structure.z };
    }

    // Default to center
    return { x: 0, z: 0 };
  }
}

export default ActionExecutor;
