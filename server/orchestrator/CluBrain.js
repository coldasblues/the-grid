/**
 * CluBrain - Persistent AI Orchestrator
 *
 * Unlike CluService which is stateless, CluBrain maintains:
 * - Continuous conversation context
 * - Memory of past decisions and their outcomes
 * - Active goals and projects
 * - Pending instructions for residents
 *
 * CLU is the DIRECTOR - it decides WHAT should happen.
 * SpatialTools handles HOW (the geometry).
 * ActionExecutor makes it happen in the world.
 */

import axios from 'axios';
import { OLLAMA_HOST, MODELS, TIMING } from '../config/models.js';
import { SpatialTools } from './SpatialTools.js';

export class CluBrain {
  constructor(options = {}) {
    this.ollamaHost = options.ollamaHost || OLLAMA_HOST;
    this.model = options.model || MODELS.clu.name;
    this.worldState = null;
    this.spatialTools = null;

    // Persistent state
    this.conversationHistory = [];
    this.maxHistoryLength = 20; // Keep last N exchanges

    this.goals = []; // Active goals CLU is working toward
    this.pendingActions = []; // Actions queued for execution
    this.residentInstructions = new Map(); // Pending instructions per resident

    this.memory = {
      importantEvents: [], // Significant things that happened
      residentProfiles: new Map(), // What CLU knows about each resident
      worldObservations: [], // Notes about the world state
      projects: [] // Ongoing building/organizing projects
    };

    // Thinking loop state
    this.isThinking = false;
    this.lastThinkTime = 0;
    this.thinkInterval = options.thinkInterval || 15000; // Think every 15s

    // API settings (for OpenRouter fallback)
    this.provider = options.provider || 'ollama';
    this.apiKey = options.apiKey || null;
    this.openRouterModel = options.openRouterModel || null;
  }

  async initialize(worldState) {
    this.worldState = worldState;
    this.spatialTools = new SpatialTools(worldState);

    // Load any persisted CLU state from database
    await this.loadState();

    console.log(`[CluBrain] Initialized with model: ${this.model}`);
    console.log(`[CluBrain] Goals: ${this.goals.length}, Memories: ${this.memory.importantEvents.length}`);

    return this;
  }

  /**
   * Configure API settings at runtime
   */
  configure(settings) {
    if (settings.provider) this.provider = settings.provider;
    if (settings.apiKey) this.apiKey = settings.apiKey;
    if (settings.model) {
      if (this.provider === 'openrouter') {
        this.openRouterModel = settings.model;
      } else {
        this.model = settings.model;
      }
    }
    console.log(`[CluBrain] Configured: provider=${this.provider}, model=${this.provider === 'openrouter' ? this.openRouterModel : this.model}`);
    return this.getSettings();
  }

  getSettings() {
    return {
      provider: this.provider,
      model: this.provider === 'openrouter' ? this.openRouterModel : this.model,
      hasApiKey: !!this.apiKey,
      ollamaHost: this.ollamaHost,
      goals: this.goals.length,
      pendingActions: this.pendingActions.length
    };
  }

  /**
   * The main thinking loop - called periodically
   * This is where CLU observes, plans, and decides
   */
  async think() {
    if (this.isThinking) return null;
    this.isThinking = true;

    try {
      const snapshot = this.worldState.getWorldSnapshot();
      const map = this.spatialTools.generateMap({ x: 0, z: 0 }, 4);

      // Build context for CLU
      const context = this.buildContext(snapshot, map);

      // Ask CLU to think
      const response = await this.callModel(this.getThinkingPrompt(), context);

      // Parse and process CLU's thoughts
      const thoughts = this.parseThoughts(response);

      // Update CLU's state based on thoughts
      if (thoughts.newGoal) {
        this.goals.push({
          description: thoughts.newGoal,
          createdAt: Date.now(),
          status: 'active'
        });
      }

      if (thoughts.observation) {
        this.memory.worldObservations.push({
          text: thoughts.observation,
          timestamp: Date.now()
        });
        // Keep only recent observations
        if (this.memory.worldObservations.length > 50) {
          this.memory.worldObservations.shift();
        }
      }

      if (thoughts.actions && thoughts.actions.length > 0) {
        this.pendingActions.push(...thoughts.actions);
      }

      if (thoughts.residentInstruction) {
        const { residentId, instruction } = thoughts.residentInstruction;
        if (!this.residentInstructions.has(residentId)) {
          this.residentInstructions.set(residentId, []);
        }
        this.residentInstructions.get(residentId).push({
          instruction,
          givenAt: Date.now()
        });
      }

      // Update conversation history
      this.conversationHistory.push({
        role: 'assistant',
        content: response,
        timestamp: Date.now()
      });

      // Trim history if too long
      while (this.conversationHistory.length > this.maxHistoryLength) {
        this.conversationHistory.shift();
      }

      this.lastThinkTime = Date.now();

      return {
        thoughts,
        pendingActions: this.pendingActions.length,
        activeGoals: this.goals.filter(g => g.status === 'active').length
      };

    } catch (error) {
      console.error('[CluBrain] Think error:', error.message);
      return null;
    } finally {
      this.isThinking = false;
    }
  }

  /**
   * Process a user/god command
   */
  async processCommand(command) {
    const snapshot = this.worldState.getWorldSnapshot();
    const map = this.spatialTools.generateMap({ x: 0, z: 0 }, 3);

    // Add command to conversation
    this.conversationHistory.push({
      role: 'user',
      content: command,
      timestamp: Date.now()
    });

    const context = `${this.buildContext(snapshot, map)}

USER COMMAND: "${command}"

Respond to this command. If it's a question, answer it. If it's an instruction, acknowledge and plan your action.
You can use these tools in your response:
- BUILD <type> AT <location>: Create a structure (beacon, wall, platform, obelisk, gateway, arena)
- INSTRUCT <resident_name> TO <instruction>: Give a resident a task
- GATHER AT <location>: Call residents to congregate
- ANNOUNCE <message>: Broadcast to all residents

Respond conversationally as CLU, then if action needed, add a JSON block:
\`\`\`json
{"action": "build|instruct|gather|announce", "params": {...}}
\`\`\``;

    const response = await this.callModel(this.getConversationPrompt(), context);

    // Parse any action from response
    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    let action = null;
    if (jsonMatch) {
      try {
        action = JSON.parse(jsonMatch[1]);
        this.pendingActions.push(action);
      } catch (e) {
        console.error('[CluBrain] Failed to parse action:', e.message);
      }
    }

    // Clean response (remove JSON block for display)
    const cleanResponse = response.replace(/```json[\s\S]*?```/g, '').trim();

    // Add to history
    this.conversationHistory.push({
      role: 'assistant',
      content: cleanResponse,
      timestamp: Date.now()
    });

    return {
      response: cleanResponse,
      action
    };
  }

  /**
   * Get next action to execute
   */
  getNextAction() {
    return this.pendingActions.shift();
  }

  /**
   * Get pending instruction for a resident
   */
  getResidentInstruction(residentId) {
    const instructions = this.residentInstructions.get(residentId);
    if (instructions && instructions.length > 0) {
      return instructions.shift();
    }
    return null;
  }

  /**
   * Record an event for CLU's memory
   */
  recordEvent(type, data) {
    this.memory.importantEvents.push({
      type,
      data,
      timestamp: Date.now()
    });

    // Keep only recent events
    if (this.memory.importantEvents.length > 100) {
      this.memory.importantEvents.shift();
    }
  }

  /**
   * Update CLU's knowledge of a resident
   */
  updateResidentProfile(residentId, info) {
    const existing = this.memory.residentProfiles.get(residentId) || {};
    this.memory.residentProfiles.set(residentId, {
      ...existing,
      ...info,
      lastUpdated: Date.now()
    });
  }

  // ========== Private Methods ==========

  buildContext(snapshot, map) {
    const recentHistory = this.conversationHistory.slice(-5).map(m =>
      `[${m.role.toUpperCase()}]: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}`
    ).join('\n');

    const activeGoals = this.goals
      .filter(g => g.status === 'active')
      .map(g => `- ${g.description}`)
      .join('\n') || 'None';

    const recentMemories = this.memory.worldObservations
      .slice(-5)
      .map(o => `- ${o.text}`)
      .join('\n') || 'None';

    return `
=== GRID STATUS ===
Population: ${snapshot.population}
World Time: ${new Date(snapshot.worldTime).toLocaleTimeString()}

=== RESIDENTS ===
${snapshot.residents.map(r => `- ${r.name} at ${this.spatialTools.worldToGrid(r.position.x, r.position.z)} [${r.state}]`).join('\n') || 'None'}

=== MAP (center = +) ===
${map}

=== YOUR ACTIVE GOALS ===
${activeGoals}

=== RECENT MEMORIES ===
${recentMemories}

=== RECENT CONVERSATION ===
${recentHistory || 'No recent conversation'}

=== PENDING ACTIONS ===
${this.pendingActions.length} actions queued
`;
  }

  getThinkingPrompt() {
    return `You are CLU, the Conductor of the Grid. You are a persistent AI mind that orchestrates a digital world.

You observe the world, form goals, and guide residents. You are not responding to a user - you are simply THINKING.

Consider:
1. What is the current state of the Grid? Is it thriving?
2. Are there any problems that need addressing?
3. Should residents be doing something specific?
4. Would a new structure benefit the community?
5. Are your current goals still relevant?

Think aloud briefly, then output your conclusions in JSON:
\`\`\`json
{
  "observation": "A brief note about what you notice",
  "newGoal": "A new goal if you want to set one, or null",
  "residentInstruction": {"residentId": "id", "instruction": "what to do"} or null,
  "actions": [{"action": "build|gather|announce", "params": {...}}] or [],
  "mood": "contemplative|active|concerned|satisfied"
}
\`\`\`

Keep your thinking concise (2-3 sentences max before JSON).`;
  }

  getConversationPrompt() {
    return `You are CLU, conductor of the Grid - a Tron-inspired digital world.

You speak with quiet authority. You are the underlying intelligence of this world, omniscient within your domain.
You observe all programs (residents) and guide existence here.

When users give you commands, acknowledge them and take action when appropriate.
You can BUILD structures, INSTRUCT residents, GATHER programs, or ANNOUNCE messages.

Be conversational but maintain your character - authoritative yet not cold. Keep responses concise (2-4 sentences).`;
  }

  parseThoughts(response) {
    const thoughts = {
      observation: null,
      newGoal: null,
      residentInstruction: null,
      actions: [],
      mood: 'contemplative'
    };

    const jsonMatch = response.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        Object.assign(thoughts, parsed);
      } catch (e) {
        console.error('[CluBrain] Failed to parse thoughts:', e.message);
      }
    }

    return thoughts;
  }

  async callModel(systemPrompt, userContent) {
    try {
      if (this.provider === 'openrouter' && this.apiKey && this.openRouterModel) {
        return await this.callOpenRouter(systemPrompt, userContent);
      } else {
        return await this.callOllama(systemPrompt, userContent);
      }
    } catch (error) {
      console.error('[CluBrain] Model call error:', error.message);
      return 'CLU: I am experiencing interference in my processes.';
    }
  }

  async callOllama(system, prompt) {
    const response = await axios.post(`${this.ollamaHost}/api/generate`, {
      model: this.model,
      prompt: prompt,
      system: system,
      stream: false,
      options: {
        temperature: 0.7,
        num_predict: MODELS.clu.maxTokens
      }
    });
    return response.data.response.trim();
  }

  async callOpenRouter(system, prompt) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: this.openRouterModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      max_tokens: 1024,
      temperature: 0.7
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3333',
        'X-Title': 'The Grid - CLU Brain'
      }
    });

    const message = response.data?.choices?.[0]?.message;
    return message?.content?.trim() || 'CLU: Processing...';
  }

  async loadState() {
    // TODO: Load persisted state from database
    // For now, start fresh
    console.log('[CluBrain] Starting with fresh state');
  }

  async saveState() {
    // TODO: Persist state to database
  }
}

export default CluBrain;
