// Ollama model configurations
// Adjust based on your hardware and preferences

export const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';

export const MODELS = {
  // CLU - The Conductor (uses larger model for complex reasoning)
  clu: {
    name: 'qwen3:30b',
    fallback: 'llama3.2:3b',
    temperature: 0.7,
    maxTokens: 2048
  },

  // Residents - Individual agents (smaller, faster model)
  resident: {
    name: 'llama3.2:3b',
    temperature: 0.8,
    maxTokens: 1024
  },

  // Soul Generator - Creates new characters
  soulGenerator: {
    name: 'llama3.2:3b',
    temperature: 0.9, // Higher creativity for unique characters
    maxTokens: 2048
  }
};

// Timing configurations
export const TIMING = {
  cluTickInterval: 30000,      // CLU thinks every 30 seconds
  residentTurnTimeout: 60000,  // Max time for a resident's turn
  minTimeBetweenTurns: 5000    // Minimum gap between resident actions
};

// World configuration
export const WORLD = {
  initialResidents: 5,
  maxResidents: 20,
  sectorSize: 50,
  viewDistance: 200
};
