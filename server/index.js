import express from 'express';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { WorldState } from './orchestrator/WorldState.js';
import { CluService } from './orchestrator/CluService.js';
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

// Initialize systems - useMock: false enables live Ollama AI
const worldState = new WorldState();
const clu = new CluService({ useMock: false });
const residentRunner = new ResidentRunner({ useMock: false });
const soulGenerator = new SoulGenerator({ useMock: true }); // Keep mock for faster spawning

// WebSocket clients
const wsClients = new Set();

function broadcast(data) {
  const message = JSON.stringify(data);
  wsClients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
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

app.post('/api/user-message', async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message required' });
    }

    // Log the message as an event
    worldState.logEvent('user_message', { message, timestamp: Date.now() });

    // Process through CLU
    const response = await clu.processUserMessage(message);

    // Broadcast to all clients
    broadcast({
      type: 'user_message',
      data: { message, response }
    });

    res.json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Settings API
app.get('/api/settings', (req, res) => {
  try {
    res.json(clu.getSettings());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', (req, res) => {
  try {
    const { provider, apiKey, model } = req.body;
    const settings = clu.configure({ provider, apiKey, model, useMock: false });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available Ollama models
app.get('/api/ollama-models', async (req, res) => {
  try {
    const response = await fetch(`${clu.ollamaHost}/api/tags`);
    const data = await response.json();
    res.json(data.models || []);
  } catch (error) {
    res.json([]); // Return empty if Ollama not available
  }
});

// Get available OpenRouter models (live from API)
app.get('/api/openrouter-models', async (req, res) => {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models');
    const data = await response.json();

    // Filter and organize models - include all models
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

app.post('/api/console', async (req, res) => {
  try {
    const { command } = req.body;

    // Log all console commands
    console.log(`[Console] Command: "${command}"`);

    // Handle console commands
    let response;
    const cmd = command.toLowerCase().trim();

    if (cmd === 'status' || cmd === 'status report') {
      response = await clu.getStatusReport();
    } else if (cmd === 'help') {
      response = `CLU: Available commands:
- status: Grid status report
- residents: List all residents
- spawn: Create a new resident
- mock [on/off]: Toggle mock/live AI mode
- instruct <text>: Give CLU an instruction
- say <text>: Broadcast message to Grid
- clear: Clear console display`;
    } else if (cmd === 'residents') {
      const residents = worldState.getAllResidents();
      response = `CLU: ${residents.length} residents active:\n` +
        residents.map(r => `  - ${r.soul_card.name} [${r.state}]`).join('\n');
    } else if (cmd === 'spawn') {
      const soul = await soulGenerator.generate({});
      worldState.addResident(soul);
      broadcast({ type: 'resident_spawned', data: soul });
      response = `CLU: New resident initialized: ${soul.name}`;
    } else if (cmd.startsWith('mock')) {
      const mode = cmd.includes('off') ? false : true;
      clu.setMockMode(mode);
      residentRunner.setMockMode(mode);
      soulGenerator.setMockMode(mode);
      response = `CLU: Mock mode ${mode ? 'ENABLED' : 'DISABLED'}. ${mode ? 'Using hardcoded responses.' : 'Using Ollama AI.'}`;
    } else if (cmd.startsWith('instruct ')) {
      // Direct instruction to CLU
      const instruction = command.substring(9).trim();
      const result = await clu.processInstruction(instruction);
      response = result.response;

      // Execute any immediate actions
      if (result.action) {
        await executeAction(result.action);
      }

      // Log the instruction
      worldState.logEvent('instruction', { instruction, response: result.response });
      broadcast({ type: 'clu_instruction', data: { instruction, response: result.response } });
    } else if (cmd.startsWith('say ')) {
      // Broadcast message to the Grid (residents can hear)
      const message = command.substring(4).trim();
      const result = await clu.processUserMessage(message);
      response = result.cluResponse;

      // Log and broadcast
      worldState.logEvent('user_broadcast', { message, response: result.cluResponse });
      broadcast({ type: 'world_event', data: { type: 'voice', message: `A voice echoes: "${message}"` } });
    } else if (cmd === 'ai status') {
      // Check AI connectivity
      const mockStatus = clu.useMock ? 'MOCK (hardcoded)' : 'LIVE (Ollama)';
      response = `CLU: AI Mode: ${mockStatus}\nModel: ${clu.model}\nHost: ${clu.ollamaHost}`;
    } else if (cmd.startsWith('do ') || cmd.startsWith('make ') || cmd.startsWith('create ')) {
      // Action-oriented commands go through instruction processing
      const result = await clu.processInstruction(command);
      response = result.response;

      if (result.action) {
        await executeAction(result.action);
      }
    } else {
      // Default: conversational chat with CLU
      response = await clu.chat(command);
    }

    // Log console interaction
    worldState.logEvent('console_command', { command, response });

    res.json({ response });
  } catch (error) {
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

  // Send current state to new client
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
 * Execute an action from CLU's instruction processing
 */
async function executeAction(action) {
  if (!action || !action.type) return;

  console.log(`[Action] Executing: ${action.type}`, action.params || '');

  switch (action.type) {
    case 'queue_spawn':
    case 'spawn_resident': {
      const soul = await soulGenerator.generate(action.params || {});
      const resident = worldState.addResident(soul);
      broadcast({ type: 'resident_spawned', data: resident });
      worldState.logEvent('resident_spawned', { id: soul.id, name: soul.name, reason: 'user_instruction' });
      break;
    }

    case 'gather_residents': {
      // Move all residents toward center
      const residents = worldState.getAllResidents();
      const target = action.params?.target || { x: 0, z: 0 };
      residents.forEach(r => {
        const dx = target.x - r.position.x;
        const dz = target.z - r.position.z;
        const dir = Math.abs(dx) > Math.abs(dz)
          ? (dx > 0 ? 'east' : 'west')
          : (dz > 0 ? 'south' : 'north');
        worldState.moveResident(r.id, { direction: dir, distance: 3 });
        broadcast({ type: 'resident_moved', data: { id: r.id, position: worldState.getResidentPosition(r.id) } });
      });
      break;
    }

    case 'broadcast_event': {
      const message = action.params?.message || 'CLU speaks to the Grid.';
      worldState.logEvent('clu_broadcast', { message });
      broadcast({ type: 'world_event', data: { type: 'clu_voice', message } });
      break;
    }

    case 'direct_resident': {
      // Direct a specific resident to do something
      if (action.params?.residentId) {
        const resident = worldState.getResident(action.params.residentId);
        if (resident) {
          // Queue this as a special instruction for the resident's next turn
          worldState.logEvent('resident_directive', {
            residentId: action.params.residentId,
            directive: action.params.directive
          });
        }
      }
      break;
    }

    default:
      console.log(`[Action] Unknown action type: ${action.type}`);
  }
}

/**
 * Main simulation loop
 */
async function simulationLoop() {
  if (!simulationRunning) return;

  cycleCount++;
  console.log(`[Simulation] Cycle ${cycleCount}`);

  try {
    // 1. CLU observes and decides
    const cluDecision = await clu.tick();
    broadcast({
      type: 'clu_tick',
      data: { cycle: cycleCount, decision: cluDecision }
    });

    // 2. Process CLU's decisions
    for (const decision of cluDecision.decisions) {
      if (decision.type === 'spawn_resident') {
        const soul = await soulGenerator.generate(decision.params);
        const resident = worldState.addResident(soul);
        broadcast({ type: 'resident_spawned', data: resident });
        worldState.logEvent('resident_spawned', { id: soul.id, name: soul.name });
      }

      if (decision.type === 'next_actor') {
        await runResidentTurn(decision.residentId);
      }

      if (decision.type === 'event') {
        worldState.logEvent(decision.event.type, decision.event);
        broadcast({ type: 'world_event', data: decision.event });
      }
    }

  } catch (error) {
    console.error('[Simulation] Error:', error);
    worldState.logEvent('error', { message: error.message });
  }

  // Schedule next tick
  setTimeout(simulationLoop, clu.tickInterval);
}

/**
 * Run a single resident's turn
 */
async function runResidentTurn(residentId) {
  const residentData = worldState.getResident(residentId);
  if (!residentData) {
    console.warn(`[Simulation] Resident ${residentId} not found`);
    return;
  }

  const soul = residentData.soul_card;
  const memories = worldState.getMemories(residentId);
  const perception = worldState.getPerception(residentId);

  broadcast({
    type: 'resident_turn_start',
    data: { id: residentId, name: soul.name }
  });

  try {
    await residentRunner.loadResident(soul, memories);
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
    }

    if (turn.action) {
      worldState.logEvent('action', { residentId, name: soul.name, action: turn.action });
      broadcast({
        type: 'resident_action',
        data: { id: residentId, name: soul.name, action: turn.action }
      });
    }

    // Store thought as memory
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
  await clu.initialize(worldState);

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
  simulationLoop();
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
  worldState.close();
  server.close(() => {
    console.log('[Server] Goodbye.');
    process.exit(0);
  });
});
