export interface StartApiResponse {
  success: boolean;
  message: string;
  ephemeralKey: string; // For backward compatibility
  ephemeralToken: string; // Required for Gemini Live
  websocketUrl: string; // Required for Gemini Live WebSocket connection
  googleMapKey?: string | undefined; // Made optional with explicit undefined
}

// Gemini Live Session Management Types
export interface GeminiSessionConfig {
  systemInstructions: string;
  model: "gemini-2.5-flash-preview-native-audio-dialog";
  audioConfig: AudioConfiguration;
  tools: GeminiTool[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export interface AudioConfiguration {
  inputSampleRate: number; // Default: 16000 (Gemini Live requirement)
  outputSampleRate: number; // Default: 24000 (Gemini Live output)
  channels: 1; // Mono (fixed)
  bitDepth: 16; // Fixed
}

export interface GeminiSessionResponse {
  sessionId: string;
  ephemeralToken: string;
  websocketUrl: string;
  expiresAt: Date;
}

export interface SessionCredentials {
  ephemeralToken: string;
  websocketUrl: string;
  sessionId: string;
}

// Gemini Live Message Types
export interface GeminiLiveMessage {
  type: MessageType;
  timestamp?: number;
  payload: MessagePayload;
}

export type MessageType =
  | "session.update"
  | "audio.input"
  | "audio.output"
  | "text.input"
  | "text.output"
  | "tool.call"
  | "tool.response"
  | "error";

export interface MessagePayload {
  [key: string]: unknown;
}

export interface SessionUpdatePayload extends MessagePayload {
  session: {
    model: "gemini-2.5-flash-preview-native-audio-dialog";
    system_instruction?: string;
    tools?: GeminiTool[];
    generation_config?: GenerationConfig;
  };
}

export interface GenerationConfig {
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
}

// Tool Definition Types
export interface GeminiTool {
  functionDeclarations: Array<{
    name: string;
    description: string;
    parameters: JSONSchema;
  }>;
}

export interface JSONSchema {
  type: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  [key: string]: unknown;
}

export interface GeminiToolCall {
  name: string;
  args: Record<string, unknown>;
  call_id: string;
}

export interface ToolCallResponse {
  type: "function_call_output";
  call_id: string;
  output: string; // JSON serialized ToolResult
}

// WebSocket Connection Types
export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export interface WebSocketClientConfig {
  url: string;
  protocols?: string[];
  reconnectAttempts?: number;
  reconnectDelay?: number;
}

// Error Types
export interface SessionError {
  code: string;
  message: string;
  details?: unknown;
}

export interface AuthError extends SessionError {
  code: "AUTH_FAILED" | "TOKEN_EXPIRED" | "INVALID_KEY";
}

export interface ConnectionError extends SessionError {
  code: "CONNECTION_FAILED" | "WEBSOCKET_ERROR" | "NETWORK_ERROR";
}

export interface ValidationError extends SessionError {
  code: "INVALID_CONFIG" | "MISSING_PARAMETER" | "INVALID_FORMAT";
}

export interface ToolError extends SessionError {
  code: "TOOL_EXECUTION_FAILED" | "TOOL_NOT_FOUND" | "INVALID_TOOL_ARGS";
}

// Result Types (for Result pattern)
export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E };

// Legacy OpenAI types (to be removed during migration)
export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: JSONSchema;
  };
}
