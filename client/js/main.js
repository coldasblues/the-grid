/**
 * The Grid - Main Entry Point
 *
 * AI Terrarium with Tron aesthetic
 */

import { GridRenderer } from './GridRenderer.js';
import { CameraController } from './CameraController.js';
import { UIManager } from './UIManager.js';
import { WebSocketClient } from './WebSocketClient.js';

class TheGrid {
  constructor() {
    this.renderer = null;
    this.camera = null;
    this.ui = null;
    this.ws = null;

    this.residents = new Map();
    this.cycle = 0;
    this.running = false;
  }

  async init() {
    console.log('[TheGrid] Initializing...');

    // Initialize renderer
    const container = document.getElementById('grid-container');
    this.renderer = new GridRenderer(container);
    this.renderer.init();

    // Initialize camera controller
    this.camera = new CameraController(
      this.renderer.getCamera(),
      this.renderer.getDomElement()
    );
    this.camera.setPosition(0, 2, 10);

    // Initialize UI
    this.ui = new UIManager();
    this.setupUICallbacks();

    // Initialize WebSocket connection
    this.ws = new WebSocketClient();
    this.setupWebSocketHandlers();

    try {
      await this.ws.connect();
      this.ui.updateCLUStatus('CONNECTED');
    } catch (error) {
      console.error('[TheGrid] WebSocket connection failed:', error);
      this.ui.updateCLUStatus('OFFLINE');
      // Continue anyway - will show existing state
    }

    // Load initial state
    await this.loadInitialState();

    // Start render loop
    this.running = true;
    this.animate();

    console.log('[TheGrid] Ready');
  }

  setupUICallbacks() {
    // Enter button clicked
    this.ui.setOnEnterGrid(() => {
      this.camera.lock();
    });

    // Console command
    this.ui.setOnConsoleCommand(async (command) => {
      await this.sendConsoleCommand(command);
    });

    // Resident selected
    this.ui.setOnResidentSelect((id) => {
      this.renderer.highlightResident(id, true);
      this.loadResidentDetails(id);
    });

    // Double-click to follow resident
    this.ui.setOnResidentFollow((id) => {
      const resident = this.residents.get(id);
      if (resident && resident.group) {
        this.camera.followResident(resident.group);
        this.ui.addConsoleLine(`Following ${resident.soul.name}`, 'system');
      }
    });

    // Camera lock/unlock
    this.camera.onLock(() => {
      // Hide UI panels slightly when in first-person
    });

    this.camera.onUnlock(() => {
      // Show UI panels
    });
  }

  setupWebSocketHandlers() {
    // Initial state
    this.ws.on('init', (data) => {
      console.log('[TheGrid] Received initial state:', data);
      this.ui.updatePopulation(data.population);
      data.residents?.forEach(r => {
        this.spawnResident(r.soul_card, r.position);
      });
    });

    // CLU tick
    this.ws.on('clu_tick', (data) => {
      this.cycle = data.cycle;
      this.ui.updateWorldTime(this.cycle);
      this.ui.updateCLUStatus('ACTIVE');
    });

    // Resident spawned
    this.ws.on('resident_spawned', (data) => {
      this.spawnResident(data.soul_card || data, data.position);
      this.ui.addEvent({
        type: 'resident_spawned',
        name: (data.soul_card || data).name
      });
      this.ui.updatePopulation(this.residents.size);
    });

    // Resident moved
    this.ws.on('resident_moved', (data) => {
      const resident = this.residents.get(data.id);
      if (resident) {
        this.renderer.moveResident(data.id, data.position, 1000);
      }
    });

    // Resident speech
    this.ws.on('resident_speech', (data) => {
      this.ui.addEvent({
        type: 'speech',
        name: data.name,
        text: data.text
      });

      // Could add speech bubble in 3D here
      this.ui.addConsoleLine(`${data.name}: ${data.text}`, 'output');
    });

    // Resident action
    this.ws.on('resident_action', (data) => {
      this.ui.addEvent({
        type: 'action',
        name: data.name,
        action: data.action
      });
    });

    // Resident turn start
    this.ws.on('resident_turn_start', (data) => {
      this.ui.highlightActiveResident(data.id);
    });

    // Resident turn end
    this.ws.on('resident_turn_end', (data) => {
      // Could trigger animations here
    });

    // World events
    this.ws.on('world_event', (data) => {
      this.ui.addEvent({
        type: 'world_event',
        message: data.message
      });
    });

    // User message response
    this.ws.on('user_message', (data) => {
      if (data.response?.cluResponse) {
        this.ui.addConsoleLine(data.response.cluResponse, 'output');
      }
    });

    // Connection events
    this.ws.on('close', () => {
      this.ui.updateCLUStatus('DISCONNECTED');
    });

    this.ws.on('error', () => {
      this.ui.updateCLUStatus('ERROR');
    });
  }

  async loadInitialState() {
    try {
      const response = await fetch('/api/residents');
      const residents = await response.json();

      residents.forEach(r => {
        this.spawnResident(r.soul_card, r.position);
      });

      this.ui.updatePopulation(residents.length);

      // Load recent events
      const eventsResponse = await fetch('/api/events?count=20');
      const events = await eventsResponse.json();

      events.reverse().forEach(event => {
        this.ui.addEvent({
          type: event.type,
          ...event.data
        });
      });

    } catch (error) {
      console.error('[TheGrid] Failed to load initial state:', error);
    }
  }

  spawnResident(soulCard, position = { x: 0, y: 0, z: 0 }) {
    if (this.residents.has(soulCard.id)) {
      // Update position instead
      this.renderer.updateResidentPosition(soulCard.id, position);
      return;
    }

    const group = this.renderer.spawnResident(soulCard, position);

    this.residents.set(soulCard.id, {
      soul: soulCard,
      group: group,
      position: position
    });

    this.ui.addResidentToList(soulCard, position);
  }

  async sendConsoleCommand(command) {
    try {
      const response = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });

      const data = await response.json();

      if (data.response) {
        // Split multi-line responses
        const lines = data.response.split('\n');
        lines.forEach(line => {
          this.ui.addConsoleLine(line, 'output');
        });
      }

      if (data.error) {
        this.ui.addConsoleLine(`Error: ${data.error}`, 'error');
      }

    } catch (error) {
      this.ui.addConsoleLine(`Error: ${error.message}`, 'error');
    }
  }

  async loadResidentDetails(id) {
    try {
      const response = await fetch(`/api/resident/${id}`);
      const data = await response.json();

      if (data.soul_card) {
        this.ui.showResidentModal(data.soul_card, data.memories || []);
      }
    } catch (error) {
      console.error('[TheGrid] Failed to load resident details:', error);
    }
  }

  animate() {
    if (!this.running) return;

    requestAnimationFrame(() => this.animate());

    const delta = this.renderer.clock.getDelta();

    // Update camera
    this.camera.update(delta);

    // Render scene
    this.renderer.render();
  }

  stop() {
    this.running = false;
    this.ws.disconnect();
    this.renderer.dispose();
  }
}

// Initialize on load
window.addEventListener('load', () => {
  const grid = new TheGrid();
  grid.init().catch(error => {
    console.error('[TheGrid] Initialization failed:', error);
  });

  // Expose for debugging
  window.theGrid = grid;
});
