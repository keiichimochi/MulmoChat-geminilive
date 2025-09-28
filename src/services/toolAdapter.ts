/**
 * Tool Adapter for OpenAI to Gemini Live API conversion
 *
 * This adapter handles the conversion between OpenAI tool calling format
 * and Gemini Live tool calling format, ensuring compatibility with
 * existing plugin system while working with the new API.
 */

import type { GeminiTool } from '../../server/types';
import type { GeminiLiveMessage } from './webSocketClient';

/**
 * OpenAI Function Definition Format (current plugin system)
 */
export interface OpenAIToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

/**
 * Gemini Live Tool Call Message Format
 */
export interface GeminiToolCall {
  type: "tool.call";
  call_id: string;
  name: string;
  args: Record<string, any>;
  [key: string]: any;
}

/**
 * Gemini Live Tool Response Message Format
 * Extends GeminiLiveMessage to ensure compatibility
 */
export interface GeminiToolResponse extends GeminiLiveMessage {
  type: "tool.response";
  call_id: string;
  output: string | Record<string, any>;
}

/**
 * Tool Adapter Class
 * Converts between OpenAI and Gemini Live tool formats
 */
export class ToolAdapter {
  /**
   * Convert OpenAI function definition to Gemini Live tool definition
   */
  static convertToGeminiTool(openaiTool: OpenAIToolDefinition): GeminiTool {
    return {
      functionDeclarations: [{
        name: openaiTool.name,
        description: openaiTool.description,
        parameters: {
          type: openaiTool.parameters.type,
          properties: openaiTool.parameters.properties,
          required: openaiTool.parameters.required,
        },
      }],
    };
  }

  /**
   * Convert array of OpenAI tools to Gemini Live tools
   */
  static convertToolsToGemini(openaiTools: OpenAIToolDefinition[]): GeminiTool[] {
    return openaiTools.map(tool => this.convertToGeminiTool(tool));
  }

  /**
   * Extract tool call arguments from Gemini Live message
   * Ensures compatibility with existing plugin execute functions
   */
  static extractToolCallArgs(geminiToolCall: GeminiToolCall): {
    toolName: string;
    args: Record<string, any>;
    callId: string;
  } {
    return {
      toolName: geminiToolCall.name,
      args: geminiToolCall.args || {},
      callId: geminiToolCall.call_id,
    };
  }

  /**
   * Create Gemini Live tool response from plugin result
   */
  static createToolResponse(
    callId: string,
    result: {
      message: string;
      jsonData?: any;
      imageData?: string;
      url?: string;
      htmlData?: string;
      title?: string;
      instructions?: string;
      location?: string | { lat: number; lng: number };
    }
  ): GeminiToolResponse {
    // Build output payload with status and relevant data
    const outputPayload: Record<string, unknown> = {
      status: result.message,
    };

    // Include specific result data based on what's available
    if (result.jsonData !== undefined) {
      outputPayload.data = result.jsonData;
    }

    if (result.imageData) {
      outputPayload.imageData = result.imageData;
    }

    if (result.url) {
      outputPayload.url = result.url;
    }

    if (result.htmlData) {
      outputPayload.htmlData = result.htmlData;
    }

    if (result.title) {
      outputPayload.title = result.title;
    }

    if (result.location) {
      outputPayload.location = result.location;
    }

    return {
      type: "tool.response",
      call_id: callId,
      output: outputPayload,
    };
  }

  /**
   * Validate Gemini tool call structure
   */
  static isValidGeminiToolCall(message: any): message is GeminiToolCall {
    return (
      message &&
      typeof message === 'object' &&
      message.type === 'tool.call' &&
      typeof message.call_id === 'string' &&
      typeof message.name === 'string' &&
      message.args &&
      typeof message.args === 'object'
    );
  }

  /**
   * Create tool call failure response
   */
  static createToolErrorResponse(
    callId: string,
    errorMessage: string
  ): GeminiToolResponse {
    return {
      type: "tool.response",
      call_id: callId,
      output: {
        status: "error",
        error: errorMessage,
      },
    };
  }

  /**
   * Format tool arguments for logging and debugging
   */
  static formatToolCallForLogging(toolCall: GeminiToolCall): string {
    const argsStr = JSON.stringify(toolCall.args, null, 2);
    return `Tool: ${toolCall.name}\nCall ID: ${toolCall.call_id}\nArgs: ${argsStr}`;
  }

  /**
   * Check if message is a valid tool response acknowledgment
   */
  static isToolResponseAck(message: any): boolean {
    return (
      message &&
      typeof message === 'object' &&
      message.type === 'tool.response' &&
      typeof message.call_id === 'string'
    );
  }

  /**
   * Extract essential data from tool response for UI updates
   */
  static extractResponseData(response: GeminiToolResponse): {
    callId: string;
    status: string;
    data?: any;
    imageData?: string;
    url?: string;
    htmlData?: string;
    title?: string;
    location?: string | { lat: number; lng: number };
  } {
    const output = typeof response.output === 'string'
      ? JSON.parse(response.output)
      : response.output;

    return {
      callId: response.call_id,
      status: output.status || 'unknown',
      data: output.data,
      imageData: output.imageData,
      url: output.url,
      htmlData: output.htmlData,
      title: output.title,
      location: output.location,
    };
  }

  /**
   * Create session update message with converted tools
   * Helper for updating Gemini Live session with plugin tools
   */
  static createSessionUpdateWithTools(
    systemInstructions: string,
    openaiTools: OpenAIToolDefinition[]
  ): {
    type: "session.update";
    session: {
      model: "gemini-2.5-flash-preview-native-audio-dialog";
      system_instruction: string;
      tools: GeminiTool[];
      generation_config: {
        temperature: number;
        max_output_tokens: number;
      };
    };
  } {
    return {
      type: "session.update",
      session: {
        model: "gemini-2.5-flash-preview-native-audio-dialog",
        system_instruction: systemInstructions,
        tools: this.convertToolsToGemini(openaiTools),
        generation_config: {
          temperature: 0.7,
          max_output_tokens: 8192,
        },
      },
    };
  }
}

/**
 * Utility functions for tool management
 */
export const ToolUtils = {
  /**
   * Generate unique call ID for tool responses
   */
  generateCallId(): string {
    return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * Create standard error response for failed tool execution
   */
  createStandardErrorResponse(callId: string, error: Error | string): GeminiToolResponse {
    const errorMessage = error instanceof Error ? error.message : error;
    return ToolAdapter.createToolErrorResponse(callId, errorMessage);
  },

  /**
   * Validate tool arguments against schema
   */
  validateToolArgs(
    args: Record<string, any>,
    schema: OpenAIToolDefinition['parameters']
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    for (const required of schema.required) {
      if (!(required in args)) {
        errors.push(`Missing required parameter: ${required}`);
      }
    }

    // Basic type checking for properties
    for (const [key, value] of Object.entries(args)) {
      const propSchema = schema.properties[key];
      if (propSchema && propSchema.type) {
        const expectedType = propSchema.type;
        const actualType = typeof value;

        if (expectedType === 'string' && actualType !== 'string') {
          errors.push(`Parameter ${key} should be string, got ${actualType}`);
        } else if (expectedType === 'number' && actualType !== 'number') {
          errors.push(`Parameter ${key} should be number, got ${actualType}`);
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
          errors.push(`Parameter ${key} should be boolean, got ${actualType}`);
        } else if (expectedType === 'object' && (actualType !== 'object' || value === null)) {
          errors.push(`Parameter ${key} should be object, got ${actualType}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};

export default ToolAdapter;
