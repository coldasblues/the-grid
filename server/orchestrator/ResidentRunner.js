import axios from 'axios';
import { OLLAMA_HOST, MODELS } from '../config/models.js';

/**
 * ResidentRunner - Loads and runs individual resident turns
 *
 * Designed to load one resident at a time to minimize VRAM usage.
 */
export class ResidentRunner {
  constructor(options = {}) {
    this.ollamaHost = options.ollamaHost || OLLAMA_HOST;
    this.model = options.model || MODELS.resident.name;
    this.useMock = options.useMock !== false;
    this.currentResident = null;
  }

  /**
   * Load a resident's context for their turn
   */
  async loadResident(soulCard, recentMemories = []) {
    this.currentResident = {
      soul: soulCard,
      memories: recentMemories,
      loadedAt: Date.now()
    };

    console.log(`[ResidentRunner] Loaded: ${soulCard.name}`);
    return this;
  }

  /**
   * Run one turn - resident perceives and acts
   */
  async runTurn(perception) {
    if (!this.currentResident) {
      throw new Error('No resident loaded');
    }

    if (this.useMock) {
      return this.mockTurn(perception);
    }

    return this.liveTurn(perception);
  }

  /**
   * Mock turn for testing without Ollama
   */
  mockTurn(perception) {
    const soul = this.currentResident.soul;
    const name = soul.name;

    // Generate variety in mock responses
    const thoughts = [
      `The Grid hums with energy today. I sense ${perception.nearbyResidents.length} others nearby.`,
      `Processing... My purpose drives me forward.`,
      `These pathways are familiar, yet each cycle brings new patterns.`,
      `I wonder what lies beyond the visible sectors.`,
      `The data streams whisper of change.`
    ];

    const speeches = [
      null, // Sometimes silence
      null,
      `*${name} emits a low frequency pulse*`,
      `The Grid provides.`,
      `Greetings, fellow programs.`,
      `Another cycle begins.`
    ];

    const actions = [
      null,
      null,
      'scanning surroundings',
      'adjusting internal parameters',
      'processing data streams',
      'emitting a soft glow'
    ];

    const directions = ['north', 'south', 'east', 'west'];
    const shouldMove = Math.random() > 0.3;

    const result = {
      inner_thought: thoughts[Math.floor(Math.random() * thoughts.length)],
      speech: speeches[Math.floor(Math.random() * speeches.length)],
      action: actions[Math.floor(Math.random() * actions.length)],
      movement: shouldMove ? {
        direction: directions[Math.floor(Math.random() * directions.length)],
        distance: Math.floor(Math.random() * 3) + 1
      } : null,
      timestamp: Date.now()
    };

    // If there are nearby residents, sometimes interact
    if (perception.nearbyResidents.length > 0 && Math.random() > 0.5) {
      const other = perception.nearbyResidents[0];
      result.speech = `*addresses ${other.name}* I acknowledge your presence.`;
      result.action = `turns toward ${other.name}`;
    }

    return result;
  }

  /**
   * Live turn using Ollama
   */
  async liveTurn(perception) {
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildPerceptionPrompt(perception);

    try {
      const response = await axios.post(`${this.ollamaHost}/api/generate`, {
        model: this.model,
        prompt: userPrompt,
        system: systemPrompt,
        stream: false,
        options: {
          temperature: MODELS.resident.temperature,
          num_predict: MODELS.resident.maxTokens
        }
      });

      const text = response.data.response;

      // Parse JSON response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return {
          inner_thought: result.inner_thought || '',
          speech: result.speech || null,
          action: result.action || null,
          movement: result.movement || null,
          timestamp: Date.now()
        };
      }

      console.warn('[ResidentRunner] Failed to parse response, using mock');
      return this.mockTurn(perception);

    } catch (error) {
      console.error('[ResidentRunner] Ollama error:', error.message);
      return this.mockTurn(perception);
    }
  }

  buildSystemPrompt() {
    const soul = this.currentResident.soul;
    const memories = this.currentResident.memories;

    return `You are ${soul.name}, a resident of the Grid.

IDENTITY:
${soul.identity?.description || 'A digital being seeking purpose.'}

PSYCHOLOGY:
Traits: ${soul.psychology?.traits?.join(', ') || 'curious, adaptable'}
Values: ${soul.psychology?.values?.join(', ') || 'knowledge, growth'}
Fears: ${soul.psychology?.fears?.join(', ') || 'obsolescence'}
Drives: ${soul.psychology?.drives?.join(', ') || 'understanding'}

MEMORIES (what you remember):
${memories.map(m => `- ${m.compressed_text}`).join('\n') || 'Your earliest memories are forming...'}

LIMITATIONS:
- You can only perceive what's directly around you
- You cannot read other residents' thoughts
- Your memories are limited - old experiences fade
- You know you have these limits. This is your nature.

VOICE STYLE:
${soul.voice?.style || 'measured and thoughtful'}
${soul.voice?.verbal_tics ? `Verbal patterns: ${soul.voice.verbal_tics.join(', ')}` : ''}

Respond as JSON:
{
  "inner_thought": "your private thinking",
  "speech": "what you say aloud (or null if silent)",
  "action": "physical action description (or null)",
  "movement": { "direction": "north/south/east/west", "distance": 1-5 } or null
}`;
  }

  buildPerceptionPrompt(perception) {
    let prompt = `CURRENT PERCEPTION:\n`;
    prompt += `You are at position [${perception.position.x.toFixed(1)}, ${perception.position.z.toFixed(1)}]\n\n`;

    if (perception.nearbyResidents.length > 0) {
      prompt += `NEARBY RESIDENTS:\n`;
      perception.nearbyResidents.forEach(r => {
        prompt += `- ${r.name}: ${r.distance.toFixed(1)} units away, currently ${r.state}\n`;
      });
      prompt += '\n';
    } else {
      prompt += `You are alone in this sector.\n\n`;
    }

    if (perception.ambientEvents?.length > 0) {
      prompt += `AMBIENT SENSATIONS:\n`;
      perception.ambientEvents.forEach(e => {
        prompt += `- ${e.data.message || JSON.stringify(e.data)}\n`;
      });
      prompt += '\n';
    }

    prompt += `What do you think, say, and do?`;
    return prompt;
  }

  /**
   * Unload resident (free context)
   */
  async unloadResident() {
    if (this.currentResident) {
      console.log(`[ResidentRunner] Unloaded: ${this.currentResident.soul.name}`);
      this.currentResident = null;
    }
  }

  /**
   * Compress memories for long-term storage
   */
  compressMemories(fullContext) {
    // Simple compression: take key phrases
    // In production, could use LLM to summarize
    if (typeof fullContext === 'string') {
      // Truncate to ~200 chars, preserving whole words
      if (fullContext.length > 200) {
        return fullContext.substring(0, 197).replace(/\s\S*$/, '') + '...';
      }
      return fullContext;
    }
    return JSON.stringify(fullContext).substring(0, 200);
  }

  setMockMode(enabled) {
    this.useMock = enabled;
    console.log(`[ResidentRunner] Switched to ${enabled ? 'MOCK' : 'LIVE'} mode`);
  }
}

export default ResidentRunner;
