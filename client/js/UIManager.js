/**
 * UIManager - Handles all UI interactions for The Grid
 */
export class UIManager {
  constructor() {
    // DOM Elements
    this.elements = {
      clickOverlay: document.getElementById('click-overlay'),
      enterBtn: document.getElementById('enter-btn'),
      topBar: document.getElementById('top-bar'),
      cluStatus: document.querySelector('#clu-status span'),
      population: document.querySelector('#population span'),
      worldTime: document.querySelector('#world-time span'),
      residentPanel: document.getElementById('resident-panel'),
      residentList: document.getElementById('resident-list'),
      eventPanel: document.getElementById('event-panel'),
      eventLog: document.getElementById('event-log'),
      godConsole: document.getElementById('god-console'),
      consoleLog: document.getElementById('console-log'),
      consoleInput: document.getElementById('console-input'),
      modal: document.getElementById('resident-modal'),
      modalClose: document.getElementById('modal-close'),
      modalName: document.getElementById('modal-name'),
      modalArchetype: document.getElementById('modal-archetype'),
      modalDescription: document.getElementById('modal-description'),
      modalTraits: document.getElementById('modal-traits'),
      modalThoughtList: document.getElementById('modal-thought-list'),
      // Settings elements
      settingsBtn: document.getElementById('settings-btn'),
      settingsModal: document.getElementById('settings-modal'),
      settingsClose: document.getElementById('settings-close'),
      settingsSave: document.getElementById('settings-save'),
      settingsTest: document.getElementById('settings-test'),
      settingsStatus: document.getElementById('settings-status'),
      providerRadios: document.querySelectorAll('input[name="provider"]'),
      ollamaSettings: document.getElementById('ollama-settings'),
      openrouterSettings: document.getElementById('openrouter-settings'),
      ollamaModelSelect: document.getElementById('ollama-model-select'),
      openrouterModelSelect: document.getElementById('openrouter-model-select'),
      apiKeyInput: document.getElementById('api-key-input')
    };

    // State
    this.consoleVisible = false;
    this.consoleHistory = [];
    this.historyIndex = -1;
    this.selectedResident = null;
    this.settingsVisible = false;

    // Callbacks
    this.onEnterGrid = null;
    this.onConsoleCommand = null;
    this.onResidentSelect = null;
    this.onResidentFollow = null;
    this.onSettingsSave = null;
    this.onSettingsTest = null;

    this.setupEventListeners();
    this.setupSettingsListeners();
  }

  setupEventListeners() {
    // Enter button
    this.elements.enterBtn.addEventListener('click', () => {
      this.hideOverlay();
      if (this.onEnterGrid) this.onEnterGrid();
    });

    // Console toggle with tilde key
    document.addEventListener('keydown', (e) => {
      // Only if not typing in console
      if (e.target !== this.elements.consoleInput) {
        if (e.code === 'Backquote') {
          e.preventDefault();
          this.toggleConsole();
        }
      }
    });

    // Console input
    this.elements.consoleInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        const command = this.elements.consoleInput.value.trim();
        if (command) {
          this.processConsoleInput(command);
          this.elements.consoleInput.value = '';
        }
      } else if (e.code === 'ArrowUp') {
        // History navigation
        if (this.historyIndex < this.consoleHistory.length - 1) {
          this.historyIndex++;
          this.elements.consoleInput.value = this.consoleHistory[this.consoleHistory.length - 1 - this.historyIndex];
        }
      } else if (e.code === 'ArrowDown') {
        if (this.historyIndex > 0) {
          this.historyIndex--;
          this.elements.consoleInput.value = this.consoleHistory[this.consoleHistory.length - 1 - this.historyIndex];
        } else {
          this.historyIndex = -1;
          this.elements.consoleInput.value = '';
        }
      } else if (e.code === 'Escape') {
        this.toggleConsole();
      }
    });

    // Modal close
    this.elements.modalClose.addEventListener('click', () => {
      this.hideModal();
    });

    // Click outside modal to close
    this.elements.modal.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) {
        this.hideModal();
      }
    });
  }

  hideOverlay() {
    this.elements.clickOverlay.classList.add('hidden');
  }

  showOverlay() {
    this.elements.clickOverlay.classList.remove('hidden');
  }

  // Console methods
  toggleConsole() {
    this.consoleVisible = !this.consoleVisible;

    if (this.consoleVisible) {
      this.elements.godConsole.classList.remove('hidden');
      this.elements.consoleInput.focus();
    } else {
      this.elements.godConsole.classList.add('hidden');
      this.elements.consoleInput.blur();
    }

    return this.consoleVisible;
  }

  isConsoleVisible() {
    return this.consoleVisible;
  }

  processConsoleInput(command) {
    // Add to history
    this.consoleHistory.push(command);
    this.historyIndex = -1;

    // Display input
    this.addConsoleLine(`> ${command}`, 'input');

    // Handle local commands
    if (command.toLowerCase() === 'clear') {
      this.clearConsole();
      return;
    }

    if (command.toLowerCase() === 'help') {
      this.addConsoleLine('Available commands:', 'system');
      this.addConsoleLine('  status  - Grid status report', 'output');
      this.addConsoleLine('  residents - List all residents', 'output');
      this.addConsoleLine('  spawn   - Create new resident', 'output');
      this.addConsoleLine('  clear   - Clear console', 'output');
      this.addConsoleLine('  mock [on/off] - Toggle mock mode', 'output');
      return;
    }

    // Send to server
    if (this.onConsoleCommand) {
      this.onConsoleCommand(command);
    }
  }

  addConsoleLine(text, type = 'output') {
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    line.textContent = text;
    this.elements.consoleLog.appendChild(line);
    this.elements.consoleLog.scrollTop = this.elements.consoleLog.scrollHeight;
  }

  clearConsole() {
    this.elements.consoleLog.innerHTML = '';
    this.addConsoleLine('Console cleared.', 'system');
  }

  // Status bar updates
  updateCLUStatus(status) {
    this.elements.cluStatus.textContent = status;
  }

  updatePopulation(count) {
    this.elements.population.textContent = count;
  }

  updateWorldTime(cycle) {
    this.elements.worldTime.textContent = cycle;
  }

  // Resident list
  addResidentToList(soulCard, position) {
    const item = document.createElement('div');
    item.className = 'resident-item';
    item.dataset.id = soulCard.id;

    item.innerHTML = `
      <div class="resident-name">${soulCard.name}</div>
      <div class="resident-archetype">${soulCard.identity?.archetype || 'Program'}</div>
    `;

    item.addEventListener('click', () => {
      this.selectResident(soulCard.id);
    });

    item.addEventListener('dblclick', () => {
      if (this.onResidentFollow) {
        this.onResidentFollow(soulCard.id);
      }
    });

    this.elements.residentList.appendChild(item);
  }

  removeResidentFromList(id) {
    const item = this.elements.residentList.querySelector(`[data-id="${id}"]`);
    if (item) {
      item.remove();
    }
  }

  selectResident(id) {
    // Remove previous selection
    const prev = this.elements.residentList.querySelector('.active');
    if (prev) prev.classList.remove('active');

    // Add new selection
    const item = this.elements.residentList.querySelector(`[data-id="${id}"]`);
    if (item) {
      item.classList.add('active');
    }

    this.selectedResident = id;

    if (this.onResidentSelect) {
      this.onResidentSelect(id);
    }
  }

  highlightActiveResident(id) {
    const items = this.elements.residentList.querySelectorAll('.resident-item');
    items.forEach(item => {
      if (item.dataset.id === id) {
        item.style.borderColor = 'var(--orange)';
      } else {
        item.style.borderColor = '';
      }
    });
  }

  // Event log
  addEvent(event) {
    const item = document.createElement('div');
    item.className = `event-item ${event.type || 'system'}`;

    const time = new Date().toLocaleTimeString();
    let content = '';

    switch (event.type) {
      case 'speech':
        content = `<strong>${event.name}:</strong> ${event.text}`;
        break;
      case 'action':
        content = `<em>${event.name}</em> ${event.action}`;
        break;
      case 'resident_spawned':
        content = `New resident: <strong>${event.name}</strong>`;
        break;
      case 'world_event':
        content = event.message || JSON.stringify(event);
        break;
      default:
        content = event.message || JSON.stringify(event);
    }

    item.innerHTML = `
      <div class="event-time">${time}</div>
      <div class="event-content">${content}</div>
    `;

    this.elements.eventLog.insertBefore(item, this.elements.eventLog.firstChild);

    // Limit log size
    while (this.elements.eventLog.children.length > 100) {
      this.elements.eventLog.removeChild(this.elements.eventLog.lastChild);
    }
  }

  // Modal
  showResidentModal(soulCard, memories = []) {
    this.elements.modalName.textContent = soulCard.name;
    this.elements.modalArchetype.textContent = soulCard.identity?.archetype?.toUpperCase() || 'PROGRAM';
    this.elements.modalDescription.textContent = soulCard.identity?.description || 'A resident of the Grid.';

    // Traits
    this.elements.modalTraits.innerHTML = '';
    const traits = soulCard.psychology?.traits || [];
    traits.forEach(trait => {
      const tag = document.createElement('span');
      tag.className = 'trait-tag';
      tag.textContent = trait;
      this.elements.modalTraits.appendChild(tag);
    });

    // Recent thoughts
    this.elements.modalThoughtList.innerHTML = '';
    memories.slice(0, 5).forEach(memory => {
      const item = document.createElement('div');
      item.className = 'thought-item';
      item.textContent = memory.compressed_text;
      this.elements.modalThoughtList.appendChild(item);
    });

    if (memories.length === 0) {
      this.elements.modalThoughtList.innerHTML = '<em>No recorded thoughts yet.</em>';
    }

    this.elements.modal.classList.remove('hidden');
  }

  hideModal() {
    this.elements.modal.classList.add('hidden');
  }

  // Settings modal
  setupSettingsListeners() {
    // Open settings
    this.elements.settingsBtn?.addEventListener('click', () => {
      this.showSettings();
    });

    // Close settings
    this.elements.settingsClose?.addEventListener('click', () => {
      this.hideSettings();
    });

    // Click outside to close
    this.elements.settingsModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.settingsModal) {
        this.hideSettings();
      }
    });

    // Provider toggle
    this.elements.providerRadios?.forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.toggleProviderSettings(e.target.value);
      });
    });

    // Save button
    this.elements.settingsSave?.addEventListener('click', () => {
      this.saveSettings();
    });

    // Test button
    this.elements.settingsTest?.addEventListener('click', () => {
      this.testConnection();
    });
  }

  showSettings() {
    this.elements.settingsModal?.classList.remove('hidden');
    this.settingsVisible = true;
    this.loadCurrentSettings();
    this.loadOllamaModels();
    this.loadOpenRouterModels();
  }

  hideSettings() {
    this.elements.settingsModal?.classList.add('hidden');
    this.settingsVisible = false;
    this.clearSettingsStatus();
  }

  toggleProviderSettings(provider) {
    if (provider === 'ollama') {
      this.elements.ollamaSettings?.classList.remove('hidden');
      this.elements.openrouterSettings?.classList.add('hidden');
    } else {
      this.elements.ollamaSettings?.classList.add('hidden');
      this.elements.openrouterSettings?.classList.remove('hidden');
    }
  }

  async loadCurrentSettings() {
    try {
      const response = await fetch('/api/settings');
      const settings = await response.json();

      // Set provider radio
      const providerRadio = document.querySelector(`input[name="provider"][value="${settings.provider}"]`);
      if (providerRadio) {
        providerRadio.checked = true;
        this.toggleProviderSettings(settings.provider);
      }

      // Set model selects
      if (settings.provider === 'openrouter') {
        this.elements.openrouterModelSelect.value = settings.model;
      }

      // Show API key status
      if (settings.hasApiKey) {
        this.elements.apiKeyInput.placeholder = `Current: ${settings.apiKeyPreview}`;
      }

    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async loadOllamaModels() {
    try {
      const response = await fetch('/api/ollama-models');
      const models = await response.json();

      this.elements.ollamaModelSelect.innerHTML = '';

      if (models.length === 0) {
        this.elements.ollamaModelSelect.innerHTML = '<option value="">No models found</option>';
        return;
      }

      models.forEach(model => {
        const option = document.createElement('option');
        option.value = model.name;
        option.textContent = `${model.name} (${this.formatSize(model.size)})`;
        this.elements.ollamaModelSelect.appendChild(option);
      });

    } catch (error) {
      this.elements.ollamaModelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
  }

  formatSize(bytes) {
    const gb = bytes / (1024 * 1024 * 1024);
    return gb.toFixed(1) + ' GB';
  }

  async loadOpenRouterModels() {
    try {
      const response = await fetch('/api/openrouter-models');
      const models = await response.json();

      this.elements.openrouterModelSelect.innerHTML = '';

      if (models.length === 0) {
        this.elements.openrouterModelSelect.innerHTML = '<option value="">No models available</option>';
        return;
      }

      // Group models by provider
      const grouped = {};
      models.forEach(model => {
        const provider = model.id.split('/')[0];
        if (!grouped[provider]) grouped[provider] = [];
        grouped[provider].push(model);
      });

      // Create optgroups for each provider
      Object.keys(grouped).sort().forEach(provider => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = provider.toUpperCase();

        grouped[provider].forEach(model => {
          const option = document.createElement('option');
          option.value = model.id;
          const contextK = model.context ? Math.round(model.context / 1000) + 'k' : '?';
          option.textContent = `${model.name} (${contextK})`;
          optgroup.appendChild(option);
        });

        this.elements.openrouterModelSelect.appendChild(optgroup);
      });

      // Show model count
      const modelInfo = document.getElementById('model-info');
      if (modelInfo) {
        modelInfo.textContent = `${models.length} models available`;
      }

    } catch (error) {
      console.error('Failed to load OpenRouter models:', error);
      this.elements.openrouterModelSelect.innerHTML = '<option value="">Error loading models</option>';
    }
  }

  getSelectedSettings() {
    const provider = document.querySelector('input[name="provider"]:checked')?.value || 'ollama';
    const model = provider === 'ollama'
      ? this.elements.ollamaModelSelect.value
      : this.elements.openrouterModelSelect.value;
    const apiKey = this.elements.apiKeyInput.value || null;

    return { provider, model, apiKey };
  }

  async saveSettings() {
    const settings = this.getSelectedSettings();

    if (settings.provider === 'openrouter' && !settings.apiKey && !this.elements.apiKeyInput.placeholder.includes('Current:')) {
      this.showSettingsStatus('API key required for OpenRouter', 'error');
      return;
    }

    this.showSettingsStatus('Saving...', 'info');

    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      const result = await response.json();

      if (result.success) {
        this.showSettingsStatus('Settings saved! CLU is now using ' + result.settings.model, 'success');
        if (this.onSettingsSave) this.onSettingsSave(result.settings);
      } else {
        this.showSettingsStatus('Failed to save settings', 'error');
      }

    } catch (error) {
      this.showSettingsStatus('Error: ' + error.message, 'error');
    }
  }

  async testConnection() {
    this.showSettingsStatus('Testing connection...', 'info');

    const settings = this.getSelectedSettings();

    try {
      // Save settings first
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });

      // Then test with a simple chat
      const response = await fetch('/api/console', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'hello' })
      });

      const result = await response.json();

      if (result.response && result.response.includes('CLU:')) {
        this.showSettingsStatus('Connection successful! CLU responded.', 'success');
      } else {
        this.showSettingsStatus('Connected but response unexpected', 'info');
      }

    } catch (error) {
      this.showSettingsStatus('Connection failed: ' + error.message, 'error');
    }
  }

  showSettingsStatus(message, type) {
    this.elements.settingsStatus.textContent = message;
    this.elements.settingsStatus.className = 'setting-status ' + type;
  }

  clearSettingsStatus() {
    this.elements.settingsStatus.textContent = '';
    this.elements.settingsStatus.className = 'setting-status';
  }

  // Callback setters
  setOnEnterGrid(callback) {
    this.onEnterGrid = callback;
  }

  setOnConsoleCommand(callback) {
    this.onConsoleCommand = callback;
  }

  setOnResidentSelect(callback) {
    this.onResidentSelect = callback;
  }

  setOnResidentFollow(callback) {
    this.onResidentFollow = callback;
  }

  setOnSettingsSave(callback) {
    this.onSettingsSave = callback;
  }
}

export default UIManager;
