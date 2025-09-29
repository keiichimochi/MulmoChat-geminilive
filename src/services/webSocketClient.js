import { ref } from 'vue';
/**
 * WebSocketClient for Gemini Live API
 *
 * Manages WebSocket connection to Gemini Live API, handling connection lifecycle,
 * message sending/receiving, and automatic reconnection.
 */
export class WebSocketClient {
    constructor(config) {
        Object.defineProperty(this, "ws", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "reconnectCount", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "reconnectTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "isIntentionalDisconnect", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "keepAliveTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "lastMessageTime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        // Reactive state
        Object.defineProperty(this, "status", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref('disconnected')
        });
        Object.defineProperty(this, "lastError", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref(null)
        });
        Object.defineProperty(this, "isConnected", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref(false)
        });
        // Event handlers
        Object.defineProperty(this, "messageHandlers", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "statusChangeHandlers", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "errorHandlers", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        this.config = {
            reconnectAttempts: 5,
            reconnectDelay: 1000,
            ...config,
        };
    }
    /**
     * Connect to Gemini Live WebSocket API
     */
    async connect(credentials) {
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
            await new Promise((resolve, reject) => {
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
        }
        catch (error) {
            console.error('❌ Failed to connect to Gemini Live:', error);
            this.setStatus('error');
            this.lastError.value = error instanceof Error ? error.message : 'Connection failed';
            throw error;
        }
    }
    /**
     * Disconnect from WebSocket
     */
    async disconnect() {
        this.isIntentionalDisconnect = true;
        this.clearReconnectTimer();
        this.clearKeepAliveTimer();
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
    async sendMessage(message) {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            throw new Error('WebSocket is not connected');
        }
        try {
            const messageStr = JSON.stringify(message);
            this.ws.send(messageStr);
            const inferredType = message.type ??
                (message.setup ? 'setup' : message.realtimeInput ? 'realtimeInput' : 'unknown');
            console.log('📤 Sent message to Gemini Live:', {
                type: inferredType,
                size: messageStr.length,
            });
        }
        catch (error) {
            console.error('❌ Failed to send message:', error);
            throw error;
        }
    }
    /**
     * Event handler registration
     */
    onMessage(handler) {
        this.messageHandlers.push(handler);
        return () => {
            const index = this.messageHandlers.indexOf(handler);
            if (index > -1) {
                this.messageHandlers.splice(index, 1);
            }
        };
    }
    onStatusChange(handler) {
        this.statusChangeHandlers.push(handler);
        return () => {
            const index = this.statusChangeHandlers.indexOf(handler);
            if (index > -1) {
                this.statusChangeHandlers.splice(index, 1);
            }
        };
    }
    onError(handler) {
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
    getConnectionInfo() {
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
    buildWebSocketUrl(credentials) {
        const url = new URL(credentials.websocketUrl);
        // Add authentication parameter as per Gemini Live API spec
        url.searchParams.set('access_token', credentials.ephemeralToken);
        return url.toString();
    }
    setupWebSocketEventHandlers() {
        if (!this.ws)
            return;
        this.ws.onopen = (event) => {
            console.log('✅ WebSocket connected to Gemini Live');
            this.setStatus('connected');
            this.reconnectCount = 0;
            this.lastError.value = null;
            this.lastMessageTime = Date.now();
            // Start keepalive timer
            this.startKeepAlive();
            // Note: setup message will be sent separately via sendMessage
            // The Live API requires initial setup configuration after connection
        };
        this.ws.onmessage = (event) => {
            try {
                this.lastMessageTime = Date.now();
                const message = JSON.parse(event.data);
                console.log('📥 Received message from Gemini Live:', {
                    type: message.type,
                    size: event.data.length,
                });
                // Notify all message handlers
                this.messageHandlers.forEach(handler => {
                    try {
                        handler(message);
                    }
                    catch (error) {
                        console.error('❌ Error in message handler:', error);
                    }
                });
            }
            catch (error) {
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
            }
            else {
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
    handleUnexpectedDisconnect() {
        if (this.reconnectCount < (this.config.reconnectAttempts || 5)) {
            this.attemptReconnect();
        }
        else {
            console.error('❌ Max reconnection attempts reached');
            this.setStatus('error');
            this.lastError.value = 'Max reconnection attempts reached';
        }
    }
    attemptReconnect() {
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
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    startKeepAlive() {
        this.clearKeepAliveTimer();
        // Check connection health every 30 seconds
        this.keepAliveTimer = window.setInterval(() => {
            const now = Date.now();
            const timeSinceLastMessage = now - this.lastMessageTime;
            // If no message received in 60 seconds, connection might be stale
            if (timeSinceLastMessage > 60000) {
                console.warn('⚠️ No messages received for 60 seconds, connection may be stale');
            }
            // Send a ping to keep connection alive if idle for more than 20 seconds
            if (timeSinceLastMessage > 20000 && this.ws && this.ws.readyState === WebSocket.OPEN) {
                try {
                    // Send a minimal message to keep connection alive
                    this.ws.send(JSON.stringify({ keepalive: true }));
                    console.log('💓 Sent keepalive ping');
                }
                catch (error) {
                    console.error('❌ Failed to send keepalive:', error);
                }
            }
        }, 30000); // Check every 30 seconds
    }
    clearKeepAliveTimer() {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }
    setStatus(status) {
        this.status.value = status;
        this.isConnected.value = status === 'connected';
        // Notify status change handlers
        this.statusChangeHandlers.forEach(handler => {
            try {
                handler(status);
            }
            catch (error) {
                console.error('❌ Error in status change handler:', error);
            }
        });
    }
    notifyError(error) {
        this.errorHandlers.forEach(handler => {
            try {
                handler(error);
            }
            catch (handlerError) {
                console.error('❌ Error in error handler:', handlerError);
            }
        });
    }
}
/**
 * Create WebSocket client with default configuration
 */
export function createWebSocketClient(config) {
    const defaultConfig = {
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
export function createGeminiLiveSetupMessage(systemInstructions, tools = []) {
    const setupPayload = {
        model: 'models/gemini-2.5-flash-preview-native-audio-dialog',
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 8192,
            responseModalities: ['TEXT', 'AUDIO'],
        },
        systemInstruction: {
            role: 'system',
            parts: [{ text: systemInstructions }],
        },
        realtimeInputConfig: {
            activityHandling: 'START_OF_ACTIVITY_INTERRUPTS',
            turnCoverage: 'TURN_INCLUDES_ALL_INPUT',
        },
    };
    if (tools.length > 0) {
        setupPayload.tools = tools;
    }
    return { setup: setupPayload };
}
/**
 * Helper function to create session update message (legacy compatibility)
 */
export function createSessionUpdateMessage(systemInstructions, tools = []) {
    // For Gemini Live, this should use the setup format
    return createGeminiLiveSetupMessage(systemInstructions, tools);
}
/**
 * Helper function to create text input message
 */
export function createTextInputMessage(text) {
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
export function createToolResponseMessage(callId, output) {
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
