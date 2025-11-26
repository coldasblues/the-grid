import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { WorldState } from './orchestrator/WorldState.js';
import { CluBrain } from './orchestrator/CluBrain.js';
import { CluService } from './orchestrator/CluService.js'; // Keep for API compatibility
import { SpatialTools } from './orchestrator/SpatialTools.js';
import { ActionExecutor } from './orchestrator/ActionExecutor.js';
import { ResidentRunner } from './orchestrator/ResidentRunner.js';
import { SoulGenerator } from './soul-generator/SoulGenerator.js';
import { TIMING, WORLD } from './config/models.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3333;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Initialize systems
const worldState = new WorldState();
const cluBrain = new CluBrain(); // New persistent brain
const cluService = new CluService({ useMock: false }); // Keep for API compat
const residentRunner = new ResidentRunner({ useMock: false });
const soulGenerator = new SoulGenerator({ useMock: true });

// These get initialized after worldState.init()
let spatialTools = null;
let actionExecutor = null;

// WebSocket clients
const wsClients = new Set();

function broadcast(data) {
  const message = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// REST API endpoints
app.get('/api/world', (req, res) => {
  try {
    const snapshot = worldState.getWorldSnapshot();
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/residents', (req, res) => {
  try {
    const residents = worldState.getAllResidents();
    res.json(residents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/resident/:id', (req, res) => {
  try {
    const resident = worldState.getResident(req.params.id);
    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }
    const memories = worldState.getMemories(req.params.id);
    res.json({ ...resident, memories });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/events', (req, res) => {
  try {
    const count = parseInt(req.query.count) || 50;
    const events = worldState.getRecentEvents(count);
    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get the current map view
app.get('/api/map', (req, res) => {
  try {
    const radius = parseInt(req.query.radius) || 5;
    const map = spatialTools.generateMap({ x: 0, z: 0 }, radius);
    res.json({ map, gridSize: spatialTools.gridSize });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get structures
app.get('/api/structures', (req, res) => {
  try {
    const structures = spatialTools.getStructuresNear(0, 0, 200);
    res.json(structures);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Settings API - now manages both CluBrain and CluService
app.get('/api/settings', (req, res) => {
  try {
    res.json({
      ...cluBrain.getSettings(),
      ...cluService.getSettings()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { provider, apiKey, model } = req.body;
    // Configure both systems
    cluBrain.configure({ provider, apiKey, model });
    const settings = cluService.configure({ provider, apiKey, model, useMock: false });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available Ollama models
app.get('/api/ollama-models', async (req, res) => {
  try {
    const response = await fetch(`${cluService.ollamaHost}/api/tags`);
    const data = await response.json();
    res.json(data.models || []);
  } catch (error) {
    res.json([]);
  }
});

// Get available OpenRouter models
app.get('/api/openrouter-models', async (req, res) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();
    const models = data.data
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        context: m.context_length,
        pricing: m.pricing
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json(models);
  } catch (error) {
    console.error('[OpenRouter] Failed to fetch models:', error.message);
    res.json([]);
  }
});

// Get CLU's current state (goals, pending actions, etc)
app.get('/api/clu/state', (req, res) => {
  try {
    res.json({
      goals: cluBrain.goals,
      pendingActions: cluBrain.pendingActions.length,
      residentInstructions: Object.fromEntries(cluBrain.residentInstructions),
      recentMemories: cluBrain.memory.worldObservations.slice(-10),
      conversationHistory: cluBrain.conversationHistory.slice(-5)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Console/command endpoint - the main interface
app.post('/api/console', async (req, res) => {
  try {
    const { command } = req.body;
    console.log(`[Console] Command: "${command}"`);

    let response;
    const cmd = command.toLowerCase().trim();

    // Built-in commands
    if (cmd === 'status' || cmd === 'status report') {
      const snapshot = worldState.getWorldSnapshot();
      const map = spatialTools.generateMap({ x: 0, z: 0 }, 3);
      response = `CLU: Grid Status Report
Population: ${snapshot.population}
Active Goals: ${cluBrain.goals.filter(g => g.status === 'active').length}
Pending Actions: ${cluBrain.pendingActions.length}

Map:
${map}`;
    } else if (cmd === 'help') {
      response = `CLU: Available commands:
- status: Grid status report
- residents: List all residents
- spawn: Create a new resident
- build <type>: Build a structure (beacon, wall, platform, obelisk, gateway, arena)
- gather: Call residents to center
- think: Force CLU to think cycle
- goals: Show active goals
- map: Display grid map
Or just talk to me naturally.`;
    } else if (cmd === 'residents') {
      const residents = worldState.getAllResidents();
      response = `CLU: ${residents.length} residents in the Grid:\n` +
        residents.map(r =>
          `  - ${r.soul_card.name} at ${spatialTools.worldToGrid(r.position.x, r.position.z)} [${r.state}]`
        ).join('\n');
    } else if (cmd === 'spawn') {
      const soul = await soulGenerator.generate({});
      worldState.addResident(soul);
      broadcast({ type: 'resident_spawned', data: soul });
      cluBrain.recordEvent('spawn', { name: soul.name, reason: 'user_command' });
      response = `CLU: New program initialized: ${soul.name}`;
    } else if (cmd === 'think') {
      const thoughts = await cluBrain.think();
      response = `CLU: *contemplates*\n${thoughts ?
        `Observation: ${thoughts.thoughts.observation || 'None'}\nMood: ${thoughts.thoughts.mood}` :
        'My thoughts are unclear.'}`;
    } else if (cmd === 'goals') {
      const activeGoals = cluBrain.goals.filter(g => g.status === 'active');
      response = `CLU: Active goals (${activeGoals.length}):\n` +
        (activeGoals.map(g => `  - ${g.description}`).join('\n') || '  None');
    } else if (cmd === 'map') {
      const map = spatialTools.generateMap({ x: 0, z: 0 }, 5);
      response = `CLU: Current Grid layout:\n${map}`;
    } else if (cmd === 'gather') {
      const result = await actionExecutor.execute({ action: 'gather', params: {} });
      response = result.success ?
        `CLU: I call all programs to assemble. ${result.residentsAffected} responding.` :
        `CLU: ${result.error}`;
    } else if (cmd.startsWith('build ')) {
      const type = command.substring(6).trim().toLowerCase();
      const result = await actionExecutor.execute({
        action: 'build',
        params: { type, near: 'center' }
      });
      response = result.success ?
        `CLU: ${result.template.name} constructed at ${result.gridRef}.` :
        `CLU: Construction failed: ${result.error}`;

      if (result.success) {
        broadcast({ type: 'structure_built', data: result });
      }
    } else {
      // Natural language - send to CluBrain for conversation
      const result = await cluBrain.processCommand(command);
      response = result.response;

      // Execute any action that came from the conversation
      if (result.action) {
        const actionResult = await actionExecutor.execute(result.action);
        if (actionResult.success) {
          cluBrain.recordEvent('action_executed', {
            action: result.action.action,
            result: actionResult
          });
        }
      }
    }

    // Log and respond
    worldState.logEvent('console_command', { command, response });
    res.json({ response });

  } catch (error) {
    console.error('[Console] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`[Server] The Grid is online at http://localhost:${PORT}`);
});

// WebSocket server
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WebSocket] Client connected');
  wsClients.add(ws);

  ws.send(JSON.stringify({
    type: 'init',
    data: worldState.getWorldSnapshot()
  }));

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      if (data.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (e) {
      console.error('[WebSocket] Invalid message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] Client disconnected');
    wsClients.delete(ws);
  });
});

// Simulation state
let simulationRunning = false;
let cycleCount = 0;

/**
 * CLU's thinking loop - runs independently
 */
async function cluThinkLoop() {
  if (!simulationRunning) return;

  try {
    console.log('[CluBrain] Thinking...');
    const result = await cluBrain.think();

    if (result && result.thoughts) {
      // Broadcast CLU's mood/state
      broadcast({
        type: 'clu_thought',
        data: {
          cycle: cycleCount,
          mood: result.thoughts.mood,
          observation: result.thoughts.observation,
          activeGoals: result.activeGoals,
          pendingActions: result.pendingActions
        }
      });

      // Execute any pending actions
      while (cluBrain.pendingActions.length > 0) {
        const action = cluBrain.getNextAction();
        if (action) {
          const actionResult = await actionExecutor.execute(action);
          console.log(`[CluBrain] Executed action:`, action.action, actionResult.success);
        }
      }
    }
  } catch (error) {
    console.error('[CluBrain] Think error:', error.message);
  }

  // Schedule next think cycle
  setTimeout(cluThinkLoop, cluBrain.thinkInterval);
}

/**
 * Main simulation loop - handles resident turns
 */
async function simulationLoop() {
  if (!simulationRunning) return;

  cycleCount++;
  console.log(`[Simulation] Cycle ${cycleCount}`);

  try {
    // Pick a resident to act (round-robin or random)
    const residents = worldState.getAllResidents();
    if (residents.length > 0) {
      const activeResident = residents[cycleCount % residents.length];
      await runResidentTurn(activeResident.id);
    }

  } catch (error) {
    console.error('[Simulation] Error:', error);
    worldState.logEvent('error', { message: error.message });
  }

  // Schedule next simulation tick
  setTimeout(simulationLoop, TIMING.cluTickInterval);
}

/**
 * Run a single resident's turn
 */
async function runResidentTurn(residentId) {
  const residentData = worldState.getResident(residentId);
  if (!residentData) return;

  const soul = residentData.soul_card;
  const memories = worldState.getMemories(residentId);
  const perception = worldState.getPerception(residentId);

  // Check if CLU has instructions for this resident
  const cluInstruction = cluBrain.getResidentInstruction(residentId);

  broadcast({
    type: 'resident_turn_start',
    data: { id: residentId, name: soul.name }
  });

  try {
    await residentRunner.loadResident(soul, memories);

    // Add CLU instruction to perception if present
    if (cluInstruction) {
      perception.cluDirective = cluInstruction.instruction;
      console.log(`[Resident] ${soul.name} received directive: ${cluInstruction.instruction}`);
    }

    const turn = await residentRunner.runTurn(perception);
    await residentRunner.unloadResident();

    // Apply turn results
    if (turn.movement) {
      const newPos = worldState.moveResident(residentId, turn.movement);
      if (newPos) {
        broadcast({
          type: 'resident_moved',
          data: { id: residentId, position: newPos, movement: turn.movement }
        });
      }
    }

    if (turn.speech) {
      worldState.logEvent('speech', { residentId, name: soul.name, text: turn.speech });
      broadcast({
        type: 'resident_speech',
        data: { id: residentId, name: soul.name, text: turn.speech }
      });
      // Record in CLU's memory
      cluBrain.recordEvent('speech', { resident: soul.name, text: turn.speech });
    }

    if (turn.action) {
      worldState.logEvent('action', { residentId, name: soul.name, action: turn.action });
      broadcast({
        type: 'resident_action',
        data: { id: residentId, name: soul.name, action: turn.action }
      });
    }

    if (turn.inner_thought) {
      const compressed = residentRunner.compressMemories(turn.inner_thought);
      worldState.addMemory(residentId, compressed);
    }

    worldState.updateResidentState(residentId, 'idle');

    broadcast({
      type: 'resident_turn_end',
      data: { id: residentId, turn }
    });

  } catch (error) {
    console.error(`[Simulation] Resident turn error:`, error);
  }
}

/**
 * Initialize and start the simulation
 */
async function startSimulation() {
  console.log('[Simulation] Initializing...');

  await worldState.init();

  // Initialize spatial tools and action executor
  spatialTools = new SpatialTools(worldState);
  actionExecutor = new ActionExecutor(worldState, spatialTools, broadcast);

  // Initialize both CLU systems
  await cluBrain.initialize(worldState);
  await cluService.initialize(worldState);

  // Spawn initial residents if empty
  const currentResidents = worldState.getAllResidents();
  if (currentResidents.length === 0) {
    console.log('[Simulation] Spawning initial residents...');
    for (let i = 0; i < WORLD.initialResidents; i++) {
      const soul = await soulGenerator.generate({
        role_in_society: ['philosopher', 'builder', 'explorer', 'artist', 'guardian'][i % 5]
      });
      worldState.addResident(soul);
      console.log(`[Simulation] Spawned: ${soul.name}`);
    }
  }

  simulationRunning = true;
  console.log('[Simulation] Starting main loop');
  console.log('[CluBrain] Starting thinking loop');

  // Start both loops
  simulationLoop();
  setTimeout(cluThinkLoop, 5000); // Start CLU thinking after 5 seconds
}

// Start everything
startSimulation().catch(err => {
  console.error('[Fatal] Failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Server] Shutting down...');
  simulationRunning = false;
  cluBrain.saveState();
  worldState.close();
  server.close(() => {
    console.log('[Server] Goodbye.');
    process.exit(0);
  });
});
