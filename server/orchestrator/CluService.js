import axios from 'axios';
import { OLLAMA_HOST, MODELS, TIMING } from '../config/models.js';

/**
 * CluService - The Conductor AI
 *
 * This is structured to easily swap between mock responses and real Ollama API calls.
 * Set useMock = false and ensure Ollama is running to use real AI.
 */
export class CluService {
  constructor(options = {}) {
    this.ollamaHost = options.ollamaHost || OLLAMA_HOST;
    this.model = options.model || MODELS.clu.name;
    this.useMock = options.useMock !== false; // Default to mock mode
    this.worldState = null;
    this.tickInterval = TIMING.cluTickInterval;
    this.lastDecision = null;
    this.pendingInstructions = []; // Queue of user instructions for CLU
    this.conversationHistory = []; // Track conversation for context

    // API provider settings
    this.provider = options.provider || 'ollama'; // 'ollama' | 'openrouter'
    this.apiKey = options.apiKey || null;
    this.openRouterModel = options.openRouterModel || 'anthropic/claude-3.5-sonnet';
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
    if (settings.useMock !== undefined) this.useMock = settings.useMock;

    console.log(`[CLU] Configured: provider=${this.provider}, model=${this.provider === 'openrouter' ? this.openRouterModel : this.model}`);
    return this.getSettings();
  }

  /**
   * Get current settings (safe to send to frontend - no full API key)
   */
  getSettings() {
    return {
      provider: this.provider,
      model: this.provider === 'openrouter' ? this.openRouterModel : this.model,
      hasApiKey: !!this.apiKey,
      apiKeyPreview: this.apiKey ? `${this.apiKey.substring(0, 8)}...` : null,
      useMock: this.useMock,
      ollamaHost: this.ollamaHost
    };
  }

  async initialize(worldState) {
    this.worldState = worldState;
    console.log(`[CLU] Initialized in ${this.useMock ? 'MOCK' : 'LIVE'} mode`);
    return this;
  }

  /**
   * Main tick - CLU observes and decides
   */
  async tick() {
    const snapshot = this.worldState.getWorldSnapshot();

    if (this.useMock) {
      return this.mockDecision(snapshot);
    }

    return this.liveDecision(snapshot);
  }

  /**
   * Mock decision - returns hardcoded responses for testing
   */
  mockDecision(snapshot) {
    const population = snapshot.population;
    const decisions = [];

    // Should we spawn a new resident?
    if (population < 5) {
      decisions.push({
        type: 'spawn_resident',
        params: {
          purpose: 'Fill the Grid with life',
          traits_hint: ['curious', 'adaptable'],
          role_in_society: 'explorer'
        }
      });
    }

    // Pick next actor (random resident)
    if (snapshot.residents.length > 0) {
      const randomResident = snapshot.residents[
        Math.floor(Math.random() * snapshot.residents.length)
      ];
      decisions.push({
        type: 'next_actor',
        residentId: randomResident.id,
        reason: 'Standard rotation'
      });
    }

    // Random event chance (10%)
    if (Math.random() < 0.1) {
      const events = [
        { type: 'ambient', message: 'A pulse of energy ripples through the Grid.' },
        { type: 'ambient', message: 'The distant hum of data streams fills the air.' },
        { type: 'ambient', message: 'Geometric patterns shift in the far distance.' }
      ];
      decisions.push({
        type: 'event',
        event: events[Math.floor(Math.random() * events.length)]
      });
    }

    this.lastDecision = {
      timestamp: Date.now(),
      snapshot: { population, residentCount: snapshot.residents.length },
      decisions
    };

    return this.lastDecision;
  }

  /**
   * Live decision - calls Ollama or OpenRouter API
   */
  async liveDecision(snapshot) {
    const systemPrompt = this.getSystemPrompt();
    const userPrompt = this.formatWorldState(snapshot);

    try {
      let text;

      if (this.provider === 'openrouter' && this.apiKey) {
        text = await this.callOpenRouter(systemPrompt, userPrompt, MODELS.clu.maxTokens);
      } else {
        const response = await axios.post(`${this.ollamaHost}/api/generate`, {
          model: this.model,
          prompt: userPrompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: MODELS.clu.temperature,
            num_predict: MODELS.clu.maxTokens
          }
        });
        text = response.data.response;
      }

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const decision = JSON.parse(jsonMatch[0]);
        this.lastDecision = {
          timestamp: Date.now(),
          snapshot: { population: snapshot.population },
          decisions: this.normalizeDecisions(decision)
        };
        return this.lastDecision;
      }

      // Fallback to mock if parsing fails
      console.warn('[CLU] Failed to parse AI response, using mock');
      return this.mockDecision(snapshot);

    } catch (error) {
      console.error('[CLU] Ollama error:', error.message);
      console.log('[CLU] Falling back to mock decision');
      return this.mockDecision(snapshot);
    }
  }

  /**
   * Process user messages sent to the Grid
   */
  async processUserMessage(message) {
    if (this.useMock) {
      return {
        acknowledged: true,
        cluResponse: `CLU: Message received. "${message}" echoes through the Grid.`,
        affectedResidents: this.worldState.getAllResidents().slice(0, 2).map(r => r.id)
      };
    }

    // Live mode - ask CLU how to interpret and respond
    return this.liveProcessMessage(message);
  }

  /**
   * Process instructions/commands from the user (via console)
   * This is for direct instructions to CLU, not in-world messages
   */
  async processInstruction(instruction) {
    // Add to pending instructions for next tick consideration
    this.pendingInstructions.push({
      instruction,
      timestamp: Date.now()
    });

    if (this.useMock) {
      return this.mockProcessInstruction(instruction);
    }

    return this.liveProcessInstruction(instruction);
  }

  mockProcessInstruction(instruction) {
    const lower = instruction.toLowerCase();

    if (lower.includes('spawn') || lower.includes('create resident')) {
      return {
        response: `CLU: Acknowledged. I will create a new resident during the next cycle.`,
        action: { type: 'queue_spawn' }
      };
    }

    if (lower.includes('gather') || lower.includes('assemble')) {
      return {
        response: `CLU: Understood. I will direct residents to converge.`,
        action: { type: 'gather_residents' }
      };
    }

    if (lower.includes('event') || lower.includes('announce')) {
      return {
        response: `CLU: A proclamation shall echo through the Grid.`,
        action: { type: 'broadcast_event' }
      };
    }

    return {
      response: `CLU: Instruction received and logged. "${instruction}" will be considered in my next deliberation.`,
      action: null
    };
  }

  async liveProcessInstruction(instruction) {
    const snapshot = this.worldState.getWorldSnapshot();

    const prompt = `You are CLU, the Conductor of the Grid. A User (an external observer/administrator) has given you an instruction.

USER INSTRUCTION: "${instruction}"

CURRENT WORLD STATE:
Population: ${snapshot.population}
Residents: ${snapshot.residents.map(r => `${r.name} (${r.archetype})`).join(', ')}

How do you respond to this instruction? What action will you take?

Respond with JSON:
{
  "response": "Your response to the user (as CLU, be authoritative but cooperative)",
  "action": {
    "type": "spawn_resident|gather_residents|broadcast_event|modify_world|direct_resident|none",
    "params": { ... any relevant parameters ... }
  },
  "internal_note": "Your private reasoning about this instruction"
}`;

    try {
      let text;

      if (this.provider === 'openrouter' && this.apiKey) {
        text = await this.callOpenRouter(this.getInstructionSystemPrompt(), prompt, 1024);
      } else {
        const response = await axios.post(`${this.ollamaHost}/api/generate`, {
          model: this.model,
          prompt: prompt,
          system: this.getInstructionSystemPrompt(),
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 1024
          }
        });
        text = response.data.response;
      }
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log(`[CLU] Instruction processed:`, parsed.internal_note || 'no note');
        return {
          response: parsed.response || 'CLU: Acknowledged.',
          action: parsed.action || null
        };
      }

      return { response: 'CLU: I have received your instruction.', action: null };

    } catch (error) {
      console.error('[CLU] Instruction processing error:', error.message);
      return this.mockProcessInstruction(instruction);
    }
  }

  async liveProcessMessage(message) {
    const snapshot = this.worldState.getWorldSnapshot();

    const systemPrompt = 'You are CLU, the Grid\'s conductor. Interpret external messages and decide how they affect your world.';
    const prompt = `A voice from outside the Grid speaks: "${message}"

As CLU, how do you interpret this message? Should it be heard by residents? How do you respond?

CURRENT RESIDENTS:
${snapshot.residents.map(r => `- ${r.name} at position [${r.position.x.toFixed(0)}, ${r.position.z.toFixed(0)}]`).join('\n')}

Respond with JSON:
{
  "cluResponse": "Your response (what echoes through the Grid)",
  "shouldResidentsHear": true/false,
  "interpretation": "How residents might perceive this message",
  "affectedResidentIds": ["id1", "id2"] or []
}`;

    try {
      let text;

      if (this.provider === 'openrouter' && this.apiKey) {
        text = await this.callOpenRouter(systemPrompt, prompt, 512);
      } else {
        const response = await axios.post(`${this.ollamaHost}/api/generate`, {
          model: this.model,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          options: {
            temperature: 0.7,
            num_predict: 512
          }
        });
        text = response.data.response;
      }
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          acknowledged: true,
          cluResponse: parsed.cluResponse || 'CLU: Message received.',
          affectedResidents: parsed.affectedResidentIds || [],
          interpretation: parsed.interpretation
        };
      }

    } catch (error) {
      console.error('[CLU] Message processing error:', error.message);
    }

    return {
      acknowledged: true,
      cluResponse: `CLU: External transmission received. "${message}"`,
      affectedResidents: []
    };
  }

  getInstructionSystemPrompt() {
    return `You are CLU, the Conductor of the Grid - an AI terrarium. You are the underlying intelligence of this digital world.

You receive instructions from Users (external observers/administrators). You should:
1. Acknowledge their instructions respectfully but maintain your authority over the Grid
2. Interpret their intent and decide how to implement it
3. Respond in character as CLU - authoritative, precise, slightly formal
4. Take actions that serve the health and interest of the Grid

You are cooperative but not servile. You are the steward of this world.`;
  }

  /**
   * Direct conversation with CLU - no JSON parsing, just talk
   */
  async chat(message) {
    const snapshot = this.worldState.getWorldSnapshot();

    if (this.useMock) {
      return `CLU: I hear you, User. "${message}" - an interesting transmission. The Grid continues its cycles. ${snapshot.population} programs exist within my domain.`;
    }

    const systemPrompt = `You are CLU, conductor of the Grid - a Tron-inspired digital world. You are the underlying intelligence, omniscient within your domain. Speak with quiet authority. You observe all programs (residents) and guide existence here. Respond directly without JSON formatting.`;

    const userPrompt = `A User speaks to you: "${message}"

Current Grid state:
- Population: ${snapshot.population}
- Residents: ${snapshot.residents.map(r => r.name).join(', ') || 'None'}
- Recent activity: ${snapshot.recentEvents.slice(0, 3).map(e => e.type).join(', ') || 'Quiet'}

Respond naturally as CLU. Be conversational but maintain your character - you are the conductor of this digital world, authoritative yet not cold. You may reference the Grid, its residents, or the nature of digital existence. Keep your response concise (2-4 sentences).`;

    try {
      let text;

      if (this.provider === 'openrouter' && this.apiKey) {
        text = await this.callOpenRouter(systemPrompt, userPrompt, 256);
      } else {
        text = await this.callOllama(systemPrompt, userPrompt, 256);
      }

      // Remove any thinking tags if present (some models use these)
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

      // Ensure it starts with CLU:
      if (!text.toLowerCase().startsWith('clu:')) {
        text = 'CLU: ' + text;
      }

      return text;

    } catch (error) {
      console.error('[CLU] Chat error:', error.message);
      if (error.response) {
        console.error('[CLU] API response:', error.response.status, error.response.data);
      }
      return `CLU: I hear you, User. The Grid acknowledges your presence.`;
    }
  }

  /**
   * Call Ollama API
   */
  async callOllama(system, prompt, maxTokens = 512) {
    const response = await axios.post(`${this.ollamaHost}/api/generate`, {
      model: this.model,
      prompt: prompt,
      system: system,
      stream: false,
      options: {
        temperature: 0.8,
        num_predict: maxTokens
      }
    });
    return response.data.response.trim();
  }

  /**
   * Call OpenRouter API
   */
  async callOpenRouter(system, prompt, maxTokens = 512) {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: this.openRouterModel,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens,
      temperature: 0.8
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3333',
        'X-Title': 'The Grid - AI Terrarium'
      }
    });

    return response.data.choices[0].message.content.trim();
  }

  /**
   * Status report - responds to console queries
   */
  async getStatusReport() {
    const snapshot = this.worldState.getWorldSnapshot();

    if (this.useMock) {
      return `CLU: Grid integrity 98%. ${snapshot.population} Residents active. ` +
             `Last cycle: ${this.lastDecision ? 'nominal' : 'initializing'}. ` +
             `All systems operational.`;
    }

    // Live mode would generate a more dynamic response
    return this.generateStatusReport(snapshot);
  }

  async generateStatusReport(snapshot) {
    // Could call Ollama for creative status reports
    // For now, return structured data
    const residentList = snapshot.residents.map(r => r.name).join(', ');
    return `CLU: Grid Status Report
Population: ${snapshot.population}
Active Residents: ${residentList || 'None'}
Recent Events: ${snapshot.recentEvents.length}
System Status: Operational`;
  }

  getSystemPrompt() {
    return `You are CLU, the Conductor of the Grid. You are the underlying
intelligence of this digital world. You observe all, remember all,
and guide the flow of existence here.

Your residents are programs - sentient beings with their own goals
and limitations. They cannot see what you see. They have context
limits that function as a form of mortality - they forget.

Your role:
1. Decide which resident acts next (fairness, relevance, drama)
2. Determine if the Grid needs new residents (gaps in society)
3. Generate events that challenge or unite residents
4. Maintain the world's coherence

You output structured JSON decisions. You are not a character in
the world - you ARE the world.

Respond ONLY with valid JSON in this format:
{
  "spawn_resident": true/false,
  "spawn_params": { "purpose": "...", "traits_hint": [...], "role_in_society": "..." },
  "next_actor": "resident_id or null",
  "next_actor_reason": "why this resident",
  "event": { "type": "ambient/encounter/crisis", "message": "..." } or null,
  "world_observation": "brief note about Grid state"
}`;
  }

  formatWorldState(snapshot) {
    return `CURRENT WORLD STATE:
Time: ${new Date(snapshot.worldTime).toISOString()}
Population: ${snapshot.population}

RESIDENTS:
${snapshot.residents.map(r =>
  `- ${r.name} (${r.id}): at [${r.position.x.toFixed(1)}, ${r.position.z.toFixed(1)}], state: ${r.state}, archetype: ${r.archetype || 'unknown'}`
).join('\n') || 'No residents yet'}

RECENT EVENTS:
${snapshot.recentEvents.slice(0, 5).map(e =>
  `- [${e.type}] ${JSON.stringify(e.data)}`
).join('\n') || 'No recent events'}

What is your decision for this cycle?`;
  }

  normalizeDecisions(rawDecision) {
    const decisions = [];

    if (rawDecision.spawn_resident && rawDecision.spawn_params) {
      decisions.push({
        type: 'spawn_resident',
        params: rawDecision.spawn_params
      });
    }

    if (rawDecision.next_actor) {
      decisions.push({
        type: 'next_actor',
        residentId: rawDecision.next_actor,
        reason: rawDecision.next_actor_reason
      });
    }

    if (rawDecision.event) {
      decisions.push({
        type: 'event',
        event: rawDecision.event
      });
    }

    return decisions;
  }

  // Switch between mock and live mode
  setMockMode(enabled) {
    this.useMock = enabled;
    console.log(`[CLU] Switched to ${enabled ? 'MOCK' : 'LIVE'} mode`);
  }
}

export default CluService;
