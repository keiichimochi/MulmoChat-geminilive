/**
 * Tool Adapter for OpenAI to Gemini Live API conversion
 *
 * This adapter handles the conversion between OpenAI tool calling format
 * and Gemini Live tool calling format, ensuring compatibility with
 * existing plugin system while working with the new API.
 */
/**
 * Tool Adapter Class
 * Converts between OpenAI and Gemini Live tool formats
 */
export class ToolAdapter {
    /**
     * Remove OpenAPI-specific fields that Gemini Live does not accept.
     */
    static sanitizeSchema(schema) {
        if (!schema || typeof schema !== 'object') {
            return {};
        }
        const { additionalProperties, ...rest } = schema;
        const sanitized = { ...rest };
        if (sanitized.properties && typeof sanitized.properties === 'object') {
            const cleanedProps = {};
            const original = sanitized.properties;
            for (const [key, value] of Object.entries(original)) {
                cleanedProps[key] = this.sanitizeSchema(value);
            }
            sanitized.properties = cleanedProps;
        }
        if (sanitized.items) {
            sanitized.items = this.sanitizeSchema(sanitized.items);
        }
        return sanitized;
    }
    /**
     * Convert OpenAI function definition to Gemini Live tool definition
     */
    static convertToGeminiTool(openaiTool) {
        return {
            functionDeclarations: [{
                    name: openaiTool.name,
                    description: openaiTool.description,
                    parameters: this.sanitizeSchema(openaiTool.parameters),
                }],
        };
    }
    /**
     * Convert array of OpenAI tools to Gemini Live tools
     */
    static convertToolsToGemini(openaiTools) {
        return openaiTools.map(tool => this.convertToGeminiTool(tool));
    }
    /**
     * Extract tool call arguments from Gemini Live message
     * Ensures compatibility with existing plugin execute functions
     */
    static extractToolCallArgs(geminiToolCall) {
        return {
            toolName: geminiToolCall.name,
            args: geminiToolCall.args || {},
            callId: geminiToolCall.call_id,
        };
    }
    /**
     * Create Gemini Live tool response from plugin result
     */
    static createToolResponse(callId, result) {
        // Build output payload with status and relevant data
        const outputPayload = {
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
    static isValidGeminiToolCall(message) {
        return (message &&
            typeof message === 'object' &&
            message.type === 'tool.call' &&
            typeof message.call_id === 'string' &&
            typeof message.name === 'string' &&
            message.args &&
            typeof message.args === 'object');
    }
    /**
     * Create tool call failure response
     */
    static createToolErrorResponse(callId, errorMessage) {
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
    static formatToolCallForLogging(toolCall) {
        const argsStr = JSON.stringify(toolCall.args, null, 2);
        return `Tool: ${toolCall.name}\nCall ID: ${toolCall.call_id}\nArgs: ${argsStr}`;
    }
    /**
     * Check if message is a valid tool response acknowledgment
     */
    static isToolResponseAck(message) {
        return (message &&
            typeof message === 'object' &&
            message.type === 'tool.response' &&
            typeof message.call_id === 'string');
    }
    /**
     * Extract essential data from tool response for UI updates
     */
    static extractResponseData(response) {
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
    static createSessionUpdateWithTools(systemInstructions, openaiTools) {
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
    generateCallId() {
        return `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },
    /**
     * Create standard error response for failed tool execution
     */
    createStandardErrorResponse(callId, error) {
        const errorMessage = error instanceof Error ? error.message : error;
        return ToolAdapter.createToolErrorResponse(callId, errorMessage);
    },
    /**
     * Validate tool arguments against schema
     */
    validateToolArgs(args, schema) {
        const errors = [];
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
                }
                else if (expectedType === 'number' && actualType !== 'number') {
                    errors.push(`Parameter ${key} should be number, got ${actualType}`);
                }
                else if (expectedType === 'boolean' && actualType !== 'boolean') {
                    errors.push(`Parameter ${key} should be boolean, got ${actualType}`);
                }
                else if (expectedType === 'object' && (actualType !== 'object' || value === null)) {
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
