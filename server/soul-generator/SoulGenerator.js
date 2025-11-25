import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { OLLAMA_HOST, MODELS } from '../config/models.js';

/**
 * SoulGenerator - Creates unique resident soul cards
 */
export class SoulGenerator {
  constructor(options = {}) {
    this.ollamaHost = options.ollamaHost || OLLAMA_HOST;
    this.model = options.model || MODELS.soulGenerator.name;
    this.useMock = options.useMock !== false;
  }

  /**
   * Generate a complete soul card
   */
  async generate(parameters = {}) {
    if (this.useMock) {
      return this.mockGenerate(parameters);
    }
    return this.liveGenerate(parameters);
  }

  /**
   * Mock generation for testing
   */
  mockGenerate(parameters) {
    const archetypes = ['philosopher', 'builder', 'guardian', 'artist', 'explorer', 'analyst', 'mediator'];
    const archetype = parameters.role_in_society || archetypes[Math.floor(Math.random() * archetypes.length)];

    const names = {
      philosopher: ['Axiom', 'Thesis', 'Logos', 'Quaestor', 'Pragma'],
      builder: ['Forge', 'Construct', 'Vector', 'Nexus', 'Lattice'],
      guardian: ['Sentinel', 'Vigil', 'Bastion', 'Aegis', 'Ward'],
      artist: ['Prism', 'Flux', 'Chroma', 'Motif', 'Cadence'],
      explorer: ['Scout', 'Traverse', 'Seeker', 'Nomad', 'Drift'],
      analyst: ['Parse', 'Query', 'Index', 'Metric', 'Delta'],
      mediator: ['Bridge', 'Accord', 'Liaison', 'Pact', 'Unity']
    };

    const archetypeNames = names[archetype] || names.explorer;
    const name = archetypeNames[Math.floor(Math.random() * archetypeNames.length)] +
                 '-' + Math.floor(Math.random() * 999).toString().padStart(3, '0');

    const colors = ['#00ffcc', '#ff00ff', '#00ff00', '#ffff00', '#ff6600', '#00ffff', '#ff0066'];
    const headTypes = ['icosahedron', 'dodecahedron', 'octahedron', 'tetrahedron'];
    const torsoTypes = ['octahedron', 'box', 'cylinder', 'double-pyramid'];

    const soulCard = {
      id: uuidv4(),
      name: name,
      created: Date.now(),

      identity: {
        description: this.generateDescription(name, archetype),
        purpose: parameters.purpose || `To ${archetype === 'philosopher' ? 'seek truth' : 'serve the Grid'}`,
        archetype: archetype
      },

      psychology: {
        traits: this.generateTraits(archetype, parameters.traits_hint),
        values: this.generateValues(archetype),
        fears: this.generateFears(archetype),
        drives: this.generateDrives(archetype)
      },

      form: {
        height: 1.5 + Math.random() * 0.6,
        build: ['lean', 'balanced', 'sturdy'][Math.floor(Math.random() * 3)],
        head: {
          type: headTypes[Math.floor(Math.random() * headTypes.length)],
          scale: 0.3 + Math.random() * 0.15
        },
        torso: {
          type: torsoTypes[Math.floor(Math.random() * torsoTypes.length)],
          scale: [0.8 + Math.random() * 0.4, 1.2 + Math.random() * 0.6, 0.4 + Math.random() * 0.3]
        },
        limbs: {
          segments: [4, 6, 8][Math.floor(Math.random() * 3)],
          taper: 0.5 + Math.random() * 0.4
        },
        color: colors[Math.floor(Math.random() * colors.length)],
        glowIntensity: 0.5 + Math.random() * 0.5,
        glyph: {
          shape: ['triangle', 'square', 'hexagon', 'circle', 'star'][Math.floor(Math.random() * 5)],
          position: 'chest'
        },
        distinguishing: this.generateDistinguishing()
      },

      voice: {
        style: this.generateVoiceStyle(archetype),
        verbalTics: this.generateVerbalTics(archetype),
        speechPace: ['rapid', 'measured', 'deliberate', 'flowing'][Math.floor(Math.random() * 4)]
      }
    };

    console.log(`[SoulGenerator] Created: ${name} (${archetype})`);
    return soulCard;
  }

  generateDescription(name, archetype) {
    const templates = {
      philosopher: `${name} is a contemplative presence in the Grid, forever questioning the nature of existence and seeking deeper truths within the data streams.`,
      builder: `${name} is driven to create, constructing both physical structures and logical frameworks that strengthen the Grid's foundation.`,
      guardian: `${name} watches over the Grid and its inhabitants with unwavering vigilance, ready to protect against corruption or chaos.`,
      artist: `${name} perceives beauty in patterns others overlook, expressing the Grid's hidden harmonies through creative expression.`,
      explorer: `${name} is drawn to the unknown edges of the Grid, mapping uncharted sectors and discovering forgotten data.`,
      analyst: `${name} processes information with precision, finding order in chaos and extracting meaning from raw data.`,
      mediator: `${name} facilitates understanding between programs, bridging differences and fostering cooperation.`
    };
    return templates[archetype] || templates.explorer;
  }

  generateTraits(archetype, hints = []) {
    const archetypeTraits = {
      philosopher: ['contemplative', 'questioning', 'patient', 'abstract-thinking'],
      builder: ['industrious', 'methodical', 'practical', 'persistent'],
      guardian: ['vigilant', 'protective', 'disciplined', 'resolute'],
      artist: ['creative', 'perceptive', 'emotional', 'expressive'],
      explorer: ['curious', 'adventurous', 'adaptable', 'resourceful'],
      analyst: ['logical', 'precise', 'observant', 'systematic'],
      mediator: ['empathetic', 'diplomatic', 'patient', 'fair-minded']
    };

    const base = archetypeTraits[archetype] || archetypeTraits.explorer;
    const result = [...base.slice(0, 2)];

    if (hints && hints.length > 0) {
      result.push(...hints.slice(0, 2));
    } else {
      result.push(base[2] || 'adaptable');
    }

    return result;
  }

  generateValues(archetype) {
    const values = {
      philosopher: ['truth', 'wisdom', 'understanding'],
      builder: ['creation', 'stability', 'progress'],
      guardian: ['order', 'protection', 'duty'],
      artist: ['beauty', 'expression', 'harmony'],
      explorer: ['discovery', 'freedom', 'knowledge'],
      analyst: ['accuracy', 'efficiency', 'clarity'],
      mediator: ['peace', 'cooperation', 'balance']
    };
    return values[archetype] || values.explorer;
  }

  generateFears(archetype) {
    const fears = {
      philosopher: ['meaninglessness', 'ignorance'],
      builder: ['destruction', 'obsolescence'],
      guardian: ['failure to protect', 'chaos'],
      artist: ['stagnation', 'being unheard'],
      explorer: ['confinement', 'the unknown becoming empty'],
      analyst: ['errors', 'incomplete data'],
      mediator: ['conflict', 'isolation']
    };
    return fears[archetype] || ['forgetting', 'obsolescence'];
  }

  generateDrives(archetype) {
    const drives = {
      philosopher: ['understand the Grid\'s purpose', 'achieve enlightenment'],
      builder: ['construct something lasting', 'improve the Grid'],
      guardian: ['protect the innocent', 'maintain order'],
      artist: ['create beauty', 'inspire others'],
      explorer: ['map the unknown', 'discover secrets'],
      analyst: ['optimize systems', 'find patterns'],
      mediator: ['unite programs', 'resolve conflicts']
    };
    return drives[archetype] || ['find purpose', 'grow'];
  }

  generateVoiceStyle(archetype) {
    const styles = {
      philosopher: 'thoughtful and questioning, often speaking in metaphors',
      builder: 'direct and practical, focused on actionable ideas',
      guardian: 'calm and authoritative, with underlying vigilance',
      artist: 'expressive and flowing, with poetic undertones',
      explorer: 'enthusiastic and descriptive, sharing observations',
      analyst: 'precise and measured, citing data and observations',
      mediator: 'warm and inclusive, seeking common ground'
    };
    return styles[archetype] || 'measured and thoughtful';
  }

  generateVerbalTics(archetype) {
    const tics = {
      philosopher: ['begins with "Consider..."', 'often pauses mid-thought'],
      builder: ['uses structural metaphors', 'speaks in steps and phases'],
      guardian: ['scans surroundings while speaking', 'speaks with finality'],
      artist: ['describes sensations', 'uses color and light metaphors'],
      explorer: ['references distances and directions', 'speaks with wonder'],
      analyst: ['quantifies observations', 'uses logical connectors'],
      mediator: ['acknowledges all perspectives', 'seeks confirmation']
    };
    return tics[archetype] || ['speaks deliberately'];
  }

  generateDistinguishing() {
    const features = [
      'shoulder_spikes',
      'trailing_particles',
      'crown_geometry',
      'forearm_rings',
      'chest_core',
      'back_fins',
      'orbital_fragments'
    ];

    const count = Math.floor(Math.random() * 2) + 1;
    const result = [];
    for (let i = 0; i < count; i++) {
      const feature = features[Math.floor(Math.random() * features.length)];
      if (!result.includes(feature)) {
        result.push(feature);
      }
    }
    return result;
  }

  /**
   * Live generation using Ollama
   */
  async liveGenerate(parameters) {
    const prompt = `Generate a unique soul card for a new Grid resident.

Purpose: ${parameters.purpose || 'General inhabitant'}
Suggested traits: ${parameters.traits_hint?.join(', ') || 'none specified'}
Role in society: ${parameters.role_in_society || 'to be determined'}

Create a JSON soul card with these fields:
{
  "name": "unique program name (e.g., Axiom-742)",
  "identity": {
    "description": "one paragraph essence",
    "purpose": "their reason for existing",
    "archetype": "philosopher/builder/guardian/artist/explorer/analyst/mediator"
  },
  "psychology": {
    "traits": ["trait1", "trait2", "trait3"],
    "values": ["value1", "value2"],
    "fears": ["fear1", "fear2"],
    "drives": ["drive1", "drive2"]
  },
  "voice": {
    "style": "how they speak",
    "verbalTics": ["speech pattern"],
    "speechPace": "rapid/measured/deliberate/flowing"
  }
}`;

    try {
      const response = await axios.post(`${this.ollamaHost}/api/generate`, {
        model: this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: MODELS.soulGenerator.temperature,
          num_predict: MODELS.soulGenerator.maxTokens
        }
      });

      const text = response.data.response;
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const generated = JSON.parse(jsonMatch[0]);
        // Merge with form data (which we generate procedurally)
        return {
          id: uuidv4(),
          created: Date.now(),
          ...generated,
          form: this.mockGenerate(parameters).form // Use procedural form
        };
      }

      return this.mockGenerate(parameters);

    } catch (error) {
      console.error('[SoulGenerator] Ollama error:', error.message);
      return this.mockGenerate(parameters);
    }
  }

  setMockMode(enabled) {
    this.useMock = enabled;
    console.log(`[SoulGenerator] Switched to ${enabled ? 'MOCK' : 'LIVE'} mode`);
  }
}

export default SoulGenerator;
