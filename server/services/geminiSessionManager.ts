import {
  ActivityHandling,
  GoogleGenAI,
  Modality,
  TurnCoverage,
  type LiveConnectConfig,
} from "@google/genai";
import {
  GeminiSessionConfig,
  GeminiSessionResponse,
  SessionCredentials,
  Result,
  SessionError,
  AuthError,
  ValidationError,
  AudioConfiguration,
  GeminiTool,
} from "../types";

/**
 * GeminiSessionManager
 *
 * Manages Gemini Live API sessions, including ephemeral token generation,
 * session configuration, and session lifecycle management.
 */
export class GeminiSessionManager {
  private client: GoogleGenAI;
  private apiKey: string;
  private readonly websocketApiVersion = "v1alpha";
  private sessions: Map<string, SessionInfo> = new Map();

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is required");
    }
    this.apiKey = apiKey;
    this.client = new GoogleGenAI({ apiKey });
  }

  /**
   * Create a new Gemini Live session with ephemeral token
   */
  async createSession(
    config: GeminiSessionConfig
  ): Promise<Result<GeminiSessionResponse, SessionError>> {
    try {
      // Validate configuration
      const validationResult = this.validateConfig(config);
      if (!validationResult.success) {
        return validationResult;
      }

      // Generate session ID
      const sessionId = this.generateSessionId();

      // Create an ephemeral auth token for the session using the official Gemini Live API
      const tokenInfo = await this.generateEphemeralToken(sessionId, config);
      const websocketUrl = this.getWebSocketUrl();

      const expiresAt = tokenInfo.expiresAt;

      const sessionResponse: GeminiSessionResponse = {
        sessionId,
        ephemeralToken: tokenInfo.token,
        websocketUrl,
        expiresAt,
      };

      // Store session info for management
      this.sessions.set(sessionId, {
        sessionId,
        config,
        createdAt: new Date(),
        expiresAt,
        sessionStartExpiresAt: tokenInfo.sessionStartExpiresAt,
        status: "active",
      });

      return { success: true, data: sessionResponse };
    } catch (error) {
      console.error("Failed to create Gemini Live session:", error);
      return {
        success: false,
        error: {
          code: "SESSION_CREATION_FAILED",
          message: "Failed to create session",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Refresh an existing session token
   */
  async refreshToken(sessionId: string): Promise<Result<string, AuthError>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: {
            code: "AUTH_FAILED",
            message: "Session not found",
            details: sessionId,
          },
        };
      }

      if (session.status !== "active") {
        return {
          success: false,
          error: {
            code: "TOKEN_EXPIRED",
            message: "Session is no longer active",
            details: session.status,
          },
        };
      }

      // Generate new ephemeral token
      const newToken = await this.generateEphemeralToken(sessionId, session.config);
      const newExpiresAt = newToken.expiresAt;

      // Update session info
      session.expiresAt = newExpiresAt;
      session.sessionStartExpiresAt = newToken.sessionStartExpiresAt;

      return { success: true, data: newToken.token };
    } catch (error) {
      console.error("Failed to refresh token:", error);
      return {
        success: false,
        error: {
          code: "AUTH_FAILED",
          message: "Failed to refresh token",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Validate session existence and status
   */
  async validateSession(sessionId: string): Promise<Result<boolean, ValidationError>> {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return {
          success: false,
          error: {
            code: "INVALID_CONFIG",
            message: "Session not found",
            details: sessionId,
          },
        };
      }

      const isExpired = new Date() > session.expiresAt;
      if (isExpired) {
        session.status = "expired";
        return {
          success: false,
          error: {
            code: "INVALID_CONFIG",
            message: "Session has expired",
            details: session.expiresAt.toISOString(),
          },
        };
      }

      return { success: true, data: session.status === "active" };
    } catch (error) {
      console.error("Failed to validate session:", error);
      return {
        success: false,
        error: {
          code: "INVALID_CONFIG",
          message: "Failed to validate session",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Close and cleanup a session
   */
  async closeSession(sessionId: string): Promise<Result<void, SessionError>> {
    try {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.status = "closed";
        // Keep session info for a while for logging purposes
        setTimeout(() => this.sessions.delete(sessionId), 5 * 60 * 1000); // 5 minutes
      }

      return { success: true, data: undefined };
    } catch (error) {
      console.error("Failed to close session:", error);
      return {
        success: false,
        error: {
          code: "SESSION_CLOSE_FAILED",
          message: "Failed to close session",
          details: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get session credentials for client connection
   */
  getSessionCredentials(sessionResponse: GeminiSessionResponse): SessionCredentials {
    return {
      ephemeralToken: sessionResponse.ephemeralToken,
      websocketUrl: sessionResponse.websocketUrl,
      sessionId: sessionResponse.sessionId,
    };
  }

  /**
   * Private helper methods
   */

  private validateConfig(config: GeminiSessionConfig): Result<void, ValidationError> {
    if (!config.systemInstructions || config.systemInstructions.trim().length === 0) {
      return {
        success: false,
        error: {
          code: "MISSING_PARAMETER",
          message: "System instructions are required",
          details: "systemInstructions",
        },
      };
    }

    if (config.model !== "gemini-2.5-flash-preview-native-audio-dialog") {
      return {
        success: false,
        error: {
          code: "INVALID_FORMAT",
          message: "Unsupported model",
          details: config.model,
        },
      };
    }

    if (!this.validateAudioConfig(config.audioConfig)) {
      return {
        success: false,
        error: {
          code: "INVALID_FORMAT",
          message: "Invalid audio configuration",
          details: config.audioConfig,
        },
      };
    }

    return { success: true, data: undefined };
  }

  private validateAudioConfig(audioConfig: AudioConfiguration): boolean {
    return (
      audioConfig.inputSampleRate === 16000 &&
      audioConfig.outputSampleRate === 24000 &&
      audioConfig.channels === 1 &&
      audioConfig.bitDepth === 16
    );
  }

  private generateSessionId(): string {
    return `gemini-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async generateEphemeralToken(
    sessionId: string,
    config: GeminiSessionConfig
  ): Promise<EphemeralTokenInfo> {
    const now = Date.now();
    const expireTime = new Date(now + 60 * 60 * 1000); // 60 minutes (1 hour)
    const sessionStartExpiry = new Date(now + 5 * 60 * 1000); // must connect within 5 minutes

    const normalizedModel = this.normalizeModelName(config.model);
    const liveConfig = this.buildLiveConnectConfig(config);

    try {
      const response = await this.client.authTokens.create({
        config: {
          httpOptions: { apiVersion: this.websocketApiVersion },
          uses: 1,
          expireTime: expireTime.toISOString(),
          newSessionExpireTime: sessionStartExpiry.toISOString(),
          liveConnectConstraints: {
            model: normalizedModel,
            config: liveConfig,
          },
        },
      });

      if (!response.name) {
        throw new Error("Gemini Live did not return an auth token name");
      }

      return {
        token: response.name,
        expiresAt: expireTime,
        sessionStartExpiresAt: sessionStartExpiry,
      };
    } catch (error) {
      console.error("Failed to create ephemeral token:", error);
      throw error;
    }
  }

  private getWebSocketUrl(): string {
    return `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.${this.websocketApiVersion}.GenerativeService.BidiGenerateContentConstrained`;
  }

  private normalizeModelName(model: string): string {
    return model.startsWith("models/") ? model : `models/${model}`;
  }

  private buildLiveConnectConfig(config: GeminiSessionConfig): LiveConnectConfig {
    const generationConfig = config.generationConfig
      ? {
          ...(config.generationConfig.temperature !== undefined
            ? { temperature: config.generationConfig.temperature }
            : {}),
          ...(config.generationConfig.maxOutputTokens !== undefined
            ? { maxOutputTokens: config.generationConfig.maxOutputTokens }
            : {}),
        }
      : undefined;

    const normalizedGenerationConfig =
      generationConfig && Object.keys(generationConfig).length > 0
        ? generationConfig
        : undefined;

    const liveConfig: LiveConnectConfig = {
      responseModalities: [Modality.TEXT, Modality.AUDIO],
      systemInstruction: {
        role: 'system',
        parts: [{ text: config.systemInstructions }],
      },
      realtimeInputConfig: {
        activityHandling: ActivityHandling.START_OF_ACTIVITY_INTERRUPTS,
        turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT,
      },
    };

    if (normalizedGenerationConfig) {
      liveConfig.generationConfig = normalizedGenerationConfig;
    }

    return liveConfig;
  }

  /**
   * Cleanup expired sessions (should be called periodically)
   */
  public cleanupExpiredSessions(): void {
    const now = new Date();
    for (const [sessionId, session] of this.sessions) {
      if (now > session.expiresAt) {
        session.status = "expired";
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Get session statistics for monitoring
   */
  public getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
  } {
    let activeSessions = 0;
    let expiredSessions = 0;

    const now = new Date();
    for (const session of this.sessions.values()) {
      if (session.status === "active" && now <= session.expiresAt) {
        activeSessions++;
      } else {
        expiredSessions++;
      }
    }

    return {
      totalSessions: this.sessions.size,
      activeSessions,
      expiredSessions,
    };
  }
}

/**
 * Internal session info for management
 */
interface SessionInfo {
  sessionId: string;
  config: GeminiSessionConfig;
  createdAt: Date;
  expiresAt: Date;
  sessionStartExpiresAt: Date;
  status: "active" | "expired" | "closed";
}

interface EphemeralTokenInfo {
  token: string;
  expiresAt: Date;
  sessionStartExpiresAt: Date;
}

/**
 * Default audio configuration for Gemini Live
 */
export const DEFAULT_AUDIO_CONFIG: AudioConfiguration = {
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  channels: 1,
  bitDepth: 16,
};

/**
 * Create default session configuration with enhanced options
 */
export function createDefaultSessionConfig(
  systemInstructions: string,
  tools: GeminiTool[] = [],
  options: {
    temperature?: number;
    maxOutputTokens?: number;
    audioInputSampleRate?: number;
    audioOutputSampleRate?: number;
  } = {}
): GeminiSessionConfig {
  const audioConfig: AudioConfiguration = {
    ...DEFAULT_AUDIO_CONFIG,
    inputSampleRate: options.audioInputSampleRate || DEFAULT_AUDIO_CONFIG.inputSampleRate,
    outputSampleRate: options.audioOutputSampleRate || DEFAULT_AUDIO_CONFIG.outputSampleRate,
  };

  return {
    systemInstructions,
    model: "gemini-2.5-flash-preview-native-audio-dialog",
    audioConfig,
    tools,
    generationConfig: {
      temperature: options.temperature || 0.7,
      maxOutputTokens: options.maxOutputTokens || 8192,
    },
  };
}
