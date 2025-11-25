/**
 * WebSocketClient - Real-time connection to The Grid server
 */
export class WebSocketClient {
  constructor(url = null) {
    this.url = url || `ws://${window.location.host}`;
    this.socket = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 2000;

    // Event handlers
    this.handlers = {
      init: [],
      clu_tick: [],
      resident_spawned: [],
      resident_moved: [],
      resident_speech: [],
      resident_action: [],
      resident_turn_start: [],
      resident_turn_end: [],
      world_event: [],
      user_message: [],
      error: [],
      open: [],
      close: []
    };
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url);

        this.socket.onopen = () => {
          console.log('[WebSocket] Connected to server');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.emit('open', {});
          resolve();
        };

        this.socket.onclose = () => {
          console.log('[WebSocket] Disconnected');
          this.connected = false;
          this.emit('close', {});
          this.attemptReconnect();
        };

        this.socket.onerror = (error) => {
          console.error('[WebSocket] Error:', error);
          this.emit('error', { error });
          reject(error);
        };

        this.socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (e) {
            console.error('[WebSocket] Failed to parse message:', e);
          }
        };

      } catch (error) {
        console.error('[WebSocket] Failed to connect:', error);
        reject(error);
      }
    });
  }

  handleMessage(data) {
    const { type, ...rest } = data;

    if (this.handlers[type]) {
      this.handlers[type].forEach(handler => handler(rest.data || rest));
    }

    // Log unknown message types
    if (!this.handlers[type]) {
      console.log('[WebSocket] Unknown message type:', type, data);
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WebSocket] Max reconnection attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`[WebSocket] Reconnecting... (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(() => {
        // Will trigger another reconnect via onclose
      });
    }, this.reconnectDelay);
  }

  /**
   * Register event handler
   */
  on(event, handler) {
    if (this.handlers[event]) {
      this.handlers[event].push(handler);
    } else {
      console.warn(`[WebSocket] Unknown event type: ${event}`);
    }
    return this;
  }

  /**
   * Remove event handler
   */
  off(event, handler) {
    if (this.handlers[event]) {
      const index = this.handlers[event].indexOf(handler);
      if (index > -1) {
        this.handlers[event].splice(index, 1);
      }
    }
    return this;
  }

  /**
   * Emit event to handlers
   */
  emit(event, data) {
    if (this.handlers[event]) {
      this.handlers[event].forEach(handler => handler(data));
    }
  }

  /**
   * Send message to server
   */
  send(type, data = {}) {
    if (!this.connected || !this.socket) {
      console.warn('[WebSocket] Not connected');
      return false;
    }

    this.socket.send(JSON.stringify({ type, data }));
    return true;
  }

  /**
   * Send ping to keep connection alive
   */
  ping() {
    return this.send('ping');
  }

  /**
   * Close connection
   */
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected() {
    return this.connected;
  }
}

export default WebSocketClient;
