import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class WorldState {
  constructor(dbPath = path.join(__dirname, '../../data/world.db')) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async init() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sectors (
        x INTEGER,
        z INTEGER,
        seed INTEGER,
        terrain_type TEXT DEFAULT 'empty',
        structures TEXT DEFAULT '[]',
        PRIMARY KEY (x, z)
      );

      CREATE TABLE IF NOT EXISTS residents (
        id TEXT PRIMARY KEY,
        name TEXT,
        soul_card TEXT,
        position_x REAL DEFAULT 0,
        position_y REAL DEFAULT 0,
        position_z REAL DEFAULT 0,
        state TEXT DEFAULT 'idle',
        created_at INTEGER,
        last_active INTEGER
      );

      CREATE TABLE IF NOT EXISTS structures (
        id TEXT PRIMARY KEY,
        type TEXT,
        x REAL,
        y REAL,
        z REAL,
        params TEXT,
        built_by TEXT,
        built_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT,
        data TEXT,
        timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS memories (
        resident_id TEXT,
        memory_index INTEGER,
        compressed_text TEXT,
        importance REAL DEFAULT 0.5,
        timestamp INTEGER,
        PRIMARY KEY (resident_id, memory_index)
      );

      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_memories_resident ON memories(resident_id);
    `);

    console.log('[WorldState] Database initialized');
    return this;
  }

  // Sector management
  getSector(x, z) {
    const stmt = this.db.prepare('SELECT * FROM sectors WHERE x = ? AND z = ?');
    const row = stmt.get(x, z);
    if (row) {
      row.structures = JSON.parse(row.structures || '[]');
    }
    return row;
  }

  setSector(x, z, data) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sectors (x, z, seed, terrain_type, structures)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(x, z, data.seed, data.terrain_type, JSON.stringify(data.structures || []));
  }

  // Resident management
  addResident(soulCard) {
    const stmt = this.db.prepare(`
      INSERT INTO residents (id, name, soul_card, position_x, position_y, position_z, created_at, last_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    const startX = (Math.random() - 0.5) * 40;
    const startZ = (Math.random() - 0.5) * 40;

    stmt.run(
      soulCard.id,
      soulCard.name,
      JSON.stringify(soulCard),
      startX,
      0,
      startZ,
      now,
      now
    );

    return { ...soulCard, position: { x: startX, y: 0, z: startZ } };
  }

  getResident(id) {
    const stmt = this.db.prepare('SELECT * FROM residents WHERE id = ?');
    const row = stmt.get(id);
    if (row) {
      row.soul_card = JSON.parse(row.soul_card);
      row.position = { x: row.position_x, y: row.position_y, z: row.position_z };
    }
    return row;
  }

  getAllResidents() {
    const stmt = this.db.prepare('SELECT * FROM residents');
    return stmt.all().map(row => ({
      ...row,
      soul_card: JSON.parse(row.soul_card),
      position: { x: row.position_x, y: row.position_y, z: row.position_z }
    }));
  }

  getResidentPosition(id) {
    const stmt = this.db.prepare('SELECT position_x, position_y, position_z FROM residents WHERE id = ?');
    const row = stmt.get(id);
    return row ? { x: row.position_x, y: row.position_y, z: row.position_z } : null;
  }

  setResidentPosition(id, x, y, z) {
    const stmt = this.db.prepare(`
      UPDATE residents SET position_x = ?, position_y = ?, position_z = ?, last_active = ?
      WHERE id = ?
    `);
    stmt.run(x, y, z, Date.now(), id);
  }

  moveResident(id, movement) {
    const pos = this.getResidentPosition(id);
    if (!pos) return null;

    const directions = {
      north: { x: 0, z: -1 },
      south: { x: 0, z: 1 },
      east: { x: 1, z: 0 },
      west: { x: -1, z: 0 }
    };

    const dir = directions[movement.direction] || { x: 0, z: 0 };
    const distance = movement.distance || 1;

    const newX = pos.x + dir.x * distance;
    const newZ = pos.z + dir.z * distance;

    this.setResidentPosition(id, newX, pos.y, newZ);
    return { x: newX, y: pos.y, z: newZ };
  }

  getResidentsInRadius(x, z, radius) {
    const stmt = this.db.prepare(`
      SELECT * FROM residents
      WHERE (position_x - ?)*(position_x - ?) + (position_z - ?)*(position_z - ?) <= ?*?
    `);
    return stmt.all(x, x, z, z, radius, radius).map(row => ({
      ...row,
      soul_card: JSON.parse(row.soul_card),
      position: { x: row.position_x, y: row.position_y, z: row.position_z }
    }));
  }

  updateResidentState(id, state) {
    const stmt = this.db.prepare('UPDATE residents SET state = ?, last_active = ? WHERE id = ?');
    stmt.run(state, Date.now(), id);
  }

  removeResident(id) {
    const stmt = this.db.prepare('DELETE FROM residents WHERE id = ?');
    stmt.run(id);
  }

  // Structure management
  addStructure(type, x, y, z, params, builtBy = 'system') {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO structures (id, type, x, y, z, params, built_by, built_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, type, x, y, z, JSON.stringify(params), builtBy, Date.now());
    return id;
  }

  getStructuresInSector(sectorX, sectorZ, sectorSize = 50) {
    const minX = sectorX * sectorSize;
    const maxX = minX + sectorSize;
    const minZ = sectorZ * sectorSize;
    const maxZ = minZ + sectorSize;

    const stmt = this.db.prepare(`
      SELECT * FROM structures
      WHERE x >= ? AND x < ? AND z >= ? AND z < ?
    `);
    return stmt.all(minX, maxX, minZ, maxZ).map(row => ({
      ...row,
      params: JSON.parse(row.params)
    }));
  }

  // Event logging
  logEvent(type, data) {
    const stmt = this.db.prepare(`
      INSERT INTO events (type, data, timestamp)
      VALUES (?, ?, ?)
    `);
    stmt.run(type, JSON.stringify(data), Date.now());
  }

  getRecentEvents(count = 50) {
    const stmt = this.db.prepare(`
      SELECT * FROM events ORDER BY timestamp DESC LIMIT ?
    `);
    return stmt.all(count).map(row => ({
      ...row,
      data: JSON.parse(row.data)
    }));
  }

  // Memory management
  addMemory(residentId, text, importance = 0.5) {
    // Get next memory index
    const countStmt = this.db.prepare('SELECT MAX(memory_index) as max_idx FROM memories WHERE resident_id = ?');
    const result = countStmt.get(residentId);
    const nextIndex = (result.max_idx || 0) + 1;

    const stmt = this.db.prepare(`
      INSERT INTO memories (resident_id, memory_index, compressed_text, importance, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(residentId, nextIndex, text, importance, Date.now());

    // Prune old memories if too many (keep last 100)
    const pruneStmt = this.db.prepare(`
      DELETE FROM memories
      WHERE resident_id = ? AND memory_index NOT IN (
        SELECT memory_index FROM memories WHERE resident_id = ?
        ORDER BY timestamp DESC LIMIT 100
      )
    `);
    pruneStmt.run(residentId, residentId);
  }

  getMemories(residentId, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE resident_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `);
    return stmt.all(residentId, limit);
  }

  // Perception - what a resident can see/hear
  getPerception(residentId, radius = 15) {
    const pos = this.getResidentPosition(residentId);
    if (!pos) return null;

    const nearbyResidents = this.getResidentsInRadius(pos.x, pos.z, radius)
      .filter(r => r.id !== residentId)
      .map(r => ({
        id: r.id,
        name: r.soul_card.name,
        distance: Math.sqrt(
          Math.pow(r.position.x - pos.x, 2) +
          Math.pow(r.position.z - pos.z, 2)
        ),
        state: r.state,
        appearance: r.soul_card.form
      }));

    return {
      position: pos,
      nearbyResidents,
      visibleStructures: [], // Could add structure detection
      ambientEvents: this.getRecentEvents(5).filter(e => e.type === 'ambient')
    };
  }

  // Full world snapshot for CLU
  getWorldSnapshot() {
    return {
      residents: this.getAllResidents().map(r => ({
        id: r.id,
        name: r.soul_card.name,
        position: r.position,
        state: r.state,
        archetype: r.soul_card.identity?.archetype,
        lastActive: r.last_active
      })),
      recentEvents: this.getRecentEvents(20),
      worldTime: Date.now(),
      population: this.db.prepare('SELECT COUNT(*) as count FROM residents').get().count
    };
  }

  close() {
    if (this.db) {
      this.db.close();
    }
  }
}

export default WorldState;
