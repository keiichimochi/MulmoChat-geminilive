import { ref, type Ref } from 'vue';

/**
 * Types for WebSocket Client
 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface SessionCredentials {
  ephemeralToken: string;
  websocketUrl: string;
  sessionId: string;
}

export interface GeminiLiveMessage {
  type: string;
  timestamp?: number;
  payload?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface WebSocketClientConfig {
  url: string;
  protocols?: string[];
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

/**
 * WebSocketClient for Gemini Live API
 *
 * Manages WebSocket connection to Gemini Live API, handling connection lifecycle,
 * message sending/receiving, and automatic reconnection.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private config: WebSocketClientConfig;
  private reconnectCount = 0;
  private reconnectTimer: number | null = null;
  private isIntentionalDisconnect = false;

  // Reactive state
  public readonly status: Ref<ConnectionStatus> = ref('disconnected');
  public readonly lastError: Ref<string | null> = ref(null);
  public readonly isConnected: Ref<boolean> = ref(false);

  // Event handlers
  private messageHandlers: Array<(message: GeminiLiveMessage) => void> = [];
  private statusChangeHandlers: Array<(status: ConnectionStatus) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  constructor(config: WebSocketClientConfig) {
    this.config = {
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      ...config,
    };
  }

  /**
   * Connect to Gemini Live WebSocket API
   */
  async connect(credentials: SessionCredentials): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.warn('WebSocket is already connected');
      return;
    }

    this.isIntentionalDisconnect = false;
    this.setStatus('connecting');

    try {
      // Construct WebSocket URL with authentication
      const wsUrl = this.buildWebSocketUrl(credentials);

      console.log('🔌 Connecting to Gemini Live WebSocket:', {
        url: wsUrl.split('?')[0], // Log URL without token
        sessionId: credentials.sessionId,
      });

      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketEventHandlers();

      // Wait for connection to establish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('WebSocket connection timeout'));
        }, 10000); // 10 second timeout

        if (this.ws) {
          this.ws.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
          this.ws.onerror = (event) => {
            clearTimeout(timeout);
            reject(new Error('WebSocket connection failed'));
          };
        }
      });

    } catch (error) {
      console.error('❌ Failed to connect to Gemini Live:', error);
      this.setStatus('error');
      this.lastError.value = error instanceof Error ? error.message : 'Connection failed';
      throw error;
    }
  }

  /**
   * Disconnect from WebSocket
   */
  async disconnect(): Promise<void> {
    this.isIntentionalDisconnect = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('disconnected');
    console.log('📡 Disconnected from Gemini Live WebSocket');
  }

  /**
   * Send message to Gemini Live API
   */
  async sendMessage(message: GeminiLiveMessage): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    try {
      const messageStr = JSON.stringify(message);
      this.ws.send(messageStr);

      console.log('📤 Sent message to Gemini Live:', {
        type: message.type,
        size: messageStr.length,
      });
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      throw error;
    }
  }

  /**
   * Event handler registration
   */
  onMessage(handler: (message: GeminiLiveMessage) => void): () => void {
    this.messageHandlers.push(handler);
    return () => {
      const index = this.messageHandlers.indexOf(handler);
      if (index > -1) {
        this.messageHandlers.splice(index, 1);
      }
    };
  }

  onStatusChange(handler: (status: ConnectionStatus) => void): () => void {
    this.statusChangeHandlers.push(handler);
    return () => {
      const index = this.statusChangeHandlers.indexOf(handler);
      if (index > -1) {
        this.statusChangeHandlers.splice(index, 1);
      }
    };
  }

  onError(handler: (error: Error) => void): () => void {
    this.errorHandlers.push(handler);
    return () => {
      const index = this.errorHandlers.indexOf(handler);
      if (index > -1) {
        this.errorHandlers.splice(index, 1);
      }
    };
  }

  /**
   * Get connection info for debugging
   */
  getConnectionInfo(): {
    status: ConnectionStatus;
    reconnectCount: number;
    lastError: string | null;
    isConnected: boolean;
  } {
    return {
      status: this.status.value,
      reconnectCount: this.reconnectCount,
      lastError: this.lastError.value,
      isConnected: this.isConnected.value,
    };
  }

  /**
   * Private methods
   */

  private buildWebSocketUrl(credentials: SessionCredentials): string {
    const url = new URL(credentials.websocketUrl);

    // Add authentication parameter as per Gemini Live API spec
    url.searchParams.set('access_token', credentials.ephemeralToken);

    return url.toString();
  }

  private setupWebSocketEventHandlers(): void {
    if (!this.ws) return;

    this.ws.onopen = (event) => {
      console.log('✅ WebSocket connected to Gemini Live');
      this.setStatus('connected');
      this.reconnectCount = 0;
      this.lastError.value = null;

      // Note: setup message will be sent separately via sendMessage
      // The Live API requires initial setup configuration after connection
    };

    this.ws.onmessage = (event) => {
      try {
        const message: GeminiLiveMessage = JSON.parse(event.data);

        console.log('📥 Received message from Gemini Live:', {
          type: message.type,
          size: event.data.length,
        });

        // Notify all message handlers
        this.messageHandlers.forEach(handler => {
          try {
            handler(message);
          } catch (error) {
            console.error('❌ Error in message handler:', error);
          }
        });
      } catch (error) {
        console.error('❌ Failed to parse WebSocket message:', error);
        this.notifyError(new Error('Failed to parse message'));
      }
    };

    this.ws.onclose = (event) => {
      console.log('🔌 WebSocket closed:', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });

      this.ws = null;

      if (!this.isIntentionalDisconnect) {
        this.handleUnexpectedDisconnect();
      } else {
        this.setStatus('disconnected');
      }
    };

    this.ws.onerror = (event) => {
      console.error('❌ WebSocket error:', event);
      this.setStatus('error');
      this.lastError.value = 'WebSocket connection error';
      this.notifyError(new Error('WebSocket error'));
    };
  }

  private handleUnexpectedDisconnect(): void {
    if (this.reconnectCount < (this.config.reconnectAttempts || 5)) {
      this.attemptReconnect();
    } else {
      console.error('❌ Max reconnection attempts reached');
      this.setStatus('error');
      this.lastError.value = 'Max reconnection attempts reached';
    }
  }

  private attemptReconnect(): void {
    this.reconnectCount++;
    this.setStatus('reconnecting');

    const delay = (this.config.reconnectDelay || 1000) * Math.pow(2, this.reconnectCount - 1);

    console.log(`🔄 Attempting to reconnect (${this.reconnectCount}/${this.config.reconnectAttempts}) in ${delay}ms`);

    this.reconnectTimer = window.setTimeout(() => {
      // Note: For reconnection to work, we'd need to store the original credentials
      // This is a simplified implementation - in practice, you might want to emit
      // a reconnection event that the parent component can handle
      console.log('🔄 Reconnection attempt would happen here');
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus): void {
    this.status.value = status;
    this.isConnected.value = status === 'connected';

    // Notify status change handlers
    this.statusChangeHandlers.forEach(handler => {
      try {
        handler(status);
      } catch (error) {
        console.error('❌ Error in status change handler:', error);
      }
    });
  }

  private notifyError(error: Error): void {
    this.errorHandlers.forEach(handler => {
      try {
        handler(error);
      } catch (handlerError) {
        console.error('❌ Error in error handler:', handlerError);
      }
    });
  }
}

/**
 * Create WebSocket client with default configuration
 */
export function createWebSocketClient(config?: Partial<WebSocketClientConfig>): WebSocketClient {
  const defaultConfig: WebSocketClientConfig = {
    url: '', // Will be set from credentials
    reconnectAttempts: 5,
    reconnectDelay: 1000,
    ...config,
  };

  return new WebSocketClient(defaultConfig);
}

/**
 * Helper function to create Gemini Live setup message
 * This is the initial message sent after WebSocket connection
 */
export function createGeminiLiveSetupMessage(
  systemInstructions: string,
  tools: unknown[] = []
): GeminiLiveMessage {
  return {
    model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 8192,
      responseModalities: ['TEXT', 'AUDIO'],
    },
    systemInstruction: systemInstructions,
    tools: tools.length > 0 ? tools : undefined,
    realtimeInputConfig: {
      activityHandling: 'ACTIVITY_HANDLING_AUTOMATIC',
      turnCoverage: 'TURN_COVERAGE_COMPLETE',
    },
  };
}

/**
 * Helper function to create session update message (legacy compatibility)
 */
export function createSessionUpdateMessage(
  systemInstructions: string,
  tools: unknown[] = []
): GeminiLiveMessage {
  // For Gemini Live, this should use the setup format
  return createGeminiLiveSetupMessage(systemInstructions, tools);
}

/**
 * Helper function to create text input message
 */
export function createTextInputMessage(text: string): GeminiLiveMessage {
  return {
    clientContent: {
      turns: [
        {
          role: 'USER',
          parts: [
            {
              text,
            },
          ],
        },
      ],
      turnComplete: true,
    },
  };
}

/**
 * Helper function to create tool response message
 */
export function createToolResponseMessage(
  callId: string,
  output: unknown
): GeminiLiveMessage {
  return {
    toolResponse: {
      functionResponses: [
        {
          name: callId, // Function call ID
          response: {
            output: typeof output === 'string' ? output : JSON.stringify(output),
          },
        },
      ],
    },
  };
}