import { ref, watch, nextTick } from "vue";
import { pluginTools, pluginExecute, pluginGeneratingMessage, } from "./plugins/type";
// @ts-ignore
import GoogleMap from "./components/GoogleMap.vue";
import { createWebSocketClient, createGeminiLiveSetupMessage, createTextInputMessage } from "./services/webSocketClient";
import { createAudioStreamManager, checkAudioSupport } from "./services/audioStreamManager";
import { ToolAdapter, ToolUtils } from "./services/toolAdapter";
const SYSTEM_PROMPT_KEY = "system_prompt_v2";
const DEFAULT_SYSTEM_PROMPT = "You are a teacher who explains various things in a way that even middle school students can easily understand. When words alone are not enough, you MUST use the generateImage API to draw pictures and use them to help explain. When you are talking about places, objects, people, movies, books and other things, you MUST use the generateImage API to draw pictures to make the conversation more engaging.";
const audioEl = ref(null);
const imageContainer = ref(null);
const connecting = ref(false);
const systemPrompt = ref(localStorage.getItem(SYSTEM_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT);
const messages = ref([]);
const currentText = ref("");
const pluginResults = ref([]);
const isGeneratingImage = ref(false);
const generatingMessage = ref("");
const pendingToolArgs = {};
const showConfigPopup = ref(false);
const selectedResult = ref(null);
const userInput = ref("");
const twitterEmbedData = ref({});
const googleMapKey = ref(null);
const startResponse = ref(null);
const micLevel = ref(0);
const micWaveform = ref([]);
const MAX_WAVEFORM_POINTS = 48;
watch(systemPrompt, (val) => {
    localStorage.setItem(SYSTEM_PROMPT_KEY, val);
});
watch(selectedResult, (newResult) => {
    if (newResult?.url && isTwitterUrl(newResult.url)) {
        handleTwitterEmbed(newResult.url);
    }
});
const chatActive = ref(false);
// Gemini Live connection objects
const geminiLive = {
    wsClient: null,
    audioManager: null,
    credentials: null,
};
// Speech Recognition for local transcription
const recognition = ref(null);
const isRecognizing = ref(false);
const localTranscript = ref("");
const interimTranscript = ref("");
function isRecord(value) {
    return typeof value === "object" && value !== null;
}
function isInlineAudioData(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (value.mimeType !== undefined && typeof value.mimeType !== "string") {
        return false;
    }
    if (value.data !== undefined && typeof value.data !== "string") {
        return false;
    }
    return true;
}
function isGeminiServerContentPart(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (value.text !== undefined && typeof value.text !== "string") {
        return false;
    }
    if (value.inlineData !== undefined && !isInlineAudioData(value.inlineData)) {
        return false;
    }
    return true;
}
function isGeminiServerContent(value) {
    if (!isRecord(value)) {
        return false;
    }
    const maybe = value;
    if (maybe.modelTurn !== undefined) {
        if (!isRecord(maybe.modelTurn)) {
            return false;
        }
        const parts = maybe.modelTurn.parts;
        if (parts !== undefined && (!Array.isArray(parts) || !parts.every(isGeminiServerContentPart))) {
            return false;
        }
    }
    if (maybe.turnComplete !== undefined && typeof maybe.turnComplete !== "boolean") {
        return false;
    }
    if (maybe.generationComplete !== undefined && typeof maybe.generationComplete !== "boolean") {
        return false;
    }
    return true;
}
function isGeminiFunctionCall(value) {
    if (!isRecord(value)) {
        return false;
    }
    if (typeof value.name !== "string") {
        return false;
    }
    if (value.args !== undefined && !isRecord(value.args)) {
        return false;
    }
    if (value.id !== undefined && typeof value.id !== "string") {
        return false;
    }
    return true;
}
function isGeminiToolCallPayload(value) {
    if (!isRecord(value)) {
        return false;
    }
    const functionCalls = value.functionCalls;
    if (functionCalls === undefined) {
        return true;
    }
    return Array.isArray(functionCalls) && functionCalls.every(isGeminiFunctionCall);
}
function scrollToBottomOfImageContainer() {
    nextTick(() => {
        if (imageContainer.value) {
            imageContainer.value.scrollTop = imageContainer.value.scrollHeight;
        }
    });
}
function scrollCurrentResultToTop() {
    nextTick(() => {
        const mainContent = document.querySelector(".flex-1.border.rounded.bg-gray-50.overflow-hidden");
        if (mainContent) {
            const scrollableElement = mainContent.querySelector("iframe, .w-full.h-full.overflow-auto, .w-full.h-full.flex");
            if (scrollableElement) {
                if (scrollableElement.tagName === "IFRAME") {
                    try {
                        scrollableElement.contentWindow?.scrollTo(0, 0);
                    }
                    catch (e) {
                        // Cross-origin iframe, can't scroll
                    }
                }
                else {
                    scrollableElement.scrollTop = 0;
                }
            }
        }
    });
}
function isTwitterUrl(url) {
    try {
        const urlObj = new URL(url);
        return (urlObj.hostname === "twitter.com" ||
            urlObj.hostname === "www.twitter.com" ||
            urlObj.hostname === "x.com" ||
            urlObj.hostname === "www.x.com");
    }
    catch {
        return false;
    }
}
async function fetchTwitterEmbed(url) {
    try {
        const response = await fetch(`/api/twitter-embed?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            throw new Error(`Twitter embed API error: ${response.status}`);
        }
        const data = await response.json();
        return data.success ? data.html : null;
    }
    catch (error) {
        console.error("Failed to fetch Twitter embed:", error);
        return null;
    }
}
async function handleTwitterEmbed(url) {
    if (!isTwitterUrl(url) || url in twitterEmbedData.value) {
        return;
    }
    const embedHtml = await fetchTwitterEmbed(url);
    console.log("*** Twitter embed", url, embedHtml);
    twitterEmbedData.value[url] = embedHtml;
}
async function processToolCall(msg) {
    const id = msg.id || msg.call_id;
    try {
        const argStr = pendingToolArgs[id] || msg.arguments || "";
        const args = typeof argStr === "string" ? JSON.parse(argStr) : argStr;
        delete pendingToolArgs[id];
        isGeneratingImage.value = true;
        generatingMessage.value = pluginGeneratingMessage(msg.name);
        scrollToBottomOfImageContainer();
        // Note: This is legacy WebRTC code that should be removed
        // The functionality has been moved to processGeminiToolCall function
        console.warn("⚠️ Legacy WebRTC function call handler - should be removed");
    }
    catch (e) {
        console.error("Legacy code error:", e);
    }
}
async function messageHandler(message) {
    console.log("📥 Received Gemini Live message:", JSON.stringify(message, null, 2));
    try {
        // Handle Gemini Live API message structure
        if (message.setupComplete) {
            console.log("✅ Gemini Live setup completed");
            return;
        }
        if (isGeminiServerContent(message.serverContent)) {
            const serverContent = message.serverContent;
            // Handle user transcription (speech-to-text result)
            if (serverContent.transcript) {
                const transcript = serverContent.transcript;
                if (transcript.text) {
                    console.log("🎤 User speech transcribed:", transcript.text);
                    messages.value.push(`You (voice): ${transcript.text}`);
                }
            }
            // Handle model turn with text and audio content
            if (serverContent.modelTurn?.parts) {
                for (const part of serverContent.modelTurn.parts) {
                    if (part.text) {
                        console.log("📝 Received text:", part.text);
                        currentText.value += part.text;
                    }
                    if (part.inlineData?.mimeType?.startsWith('audio/') && part.inlineData?.data) {
                        console.log("🔊 Received audio data");
                        await playAudioFromBase64(part.inlineData.data);
                    }
                }
            }
            // Handle completion
            if (serverContent.turnComplete || serverContent.generationComplete) {
                if (currentText.value.trim()) {
                    messages.value.push(`Assistant: ${currentText.value}`);
                }
                currentText.value = "";
            }
        }
        if (isGeminiToolCallPayload(message.toolCall)) {
            // Handle tool calls in Gemini Live format
            const toolCall = message.toolCall;
            console.log("🔧 Received tool call:", toolCall);
            if (toolCall.functionCalls) {
                for (const functionCall of toolCall.functionCalls) {
                    if (typeof functionCall.name !== "string") {
                        console.warn("Skipping invalid tool call without name", functionCall);
                        continue;
                    }
                    const callMessage = {
                        type: "tool.call",
                        call_id: functionCall.id && functionCall.id.length > 0
                            ? functionCall.id
                            : `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                        name: functionCall.name,
                        args: functionCall.args ?? {},
                    };
                    await processGeminiToolCall(callMessage);
                }
            }
        }
    }
    catch (error) {
        console.error("❌ Error handling Gemini Live message:", error);
    }
}
async function processGeminiToolCall(message) {
    // Validate tool call format using adapter (extra safety)
    if (!ToolAdapter.isValidGeminiToolCall(message)) {
        console.error("❌ Invalid Gemini tool call format:", message);
        return;
    }
    const toolCallMessage = message;
    const { toolName, args, callId } = ToolAdapter.extractToolCallArgs(toolCallMessage);
    try {
        console.log("🔧 Processing Gemini tool call:", ToolAdapter.formatToolCallForLogging(toolCallMessage));
        isGeneratingImage.value = true;
        generatingMessage.value = pluginGeneratingMessage(toolName);
        scrollToBottomOfImageContainer();
        const context = {
            images: [],
        };
        if (selectedResult.value?.imageData) {
            context.images = [selectedResult.value.imageData];
        }
        // Execute the tool using existing plugin system
        const result = await pluginExecute(context, toolName, args);
        isGeneratingImage.value = false;
        pluginResults.value.push(result);
        selectedResult.value = result;
        scrollToBottomOfImageContainer();
        scrollCurrentResultToTop();
        // Create tool response using adapter
        const toolResponse = ToolAdapter.createToolResponse(callId, result);
        if (geminiLive.wsClient) {
            await geminiLive.wsClient.sendMessage(toolResponse);
            console.log("📤 Tool response sent:", callId);
            // Send additional instructions if available
            if (result.instructions) {
                const instructionMessage = createTextInputMessage(result.instructions);
                await geminiLive.wsClient.sendMessage(instructionMessage);
            }
        }
        console.log("✅ Tool call completed:", toolName);
    }
    catch (error) {
        console.error("❌ Failed to process Gemini tool call:", error);
        isGeneratingImage.value = false;
        // Send error response using adapter
        if (geminiLive.wsClient) {
            const errorResponse = ToolUtils.createStandardErrorResponse(callId, error);
            await geminiLive.wsClient.sendMessage(errorResponse);
        }
    }
}
async function startChat() {
    // Guard against double start
    if (chatActive.value || connecting.value)
        return;
    connecting.value = true;
    try {
        // Check audio support first
        const audioSupport = checkAudioSupport();
        if (!audioSupport.hasWebAudio || !audioSupport.hasGetUserMedia) {
            throw new Error("Audio not supported in this browser");
        }
        // Call the start API endpoint to get Gemini Live session credentials
        console.log("🚀 Starting Gemini Live session...");
        const response = await fetch("/api/start", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                systemInstructions: systemPrompt.value
            })
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }
        startResponse.value = await response.json();
        if (!startResponse.value) {
            throw new Error("No response from server");
        }
        googleMapKey.value = startResponse.value.googleMapKey || "";
        if (!startResponse.value.ephemeralToken || !startResponse.value.websocketUrl) {
            throw new Error("Invalid session response from server");
        }
        // Create session credentials
        geminiLive.credentials = {
            ephemeralToken: startResponse.value.ephemeralToken,
            websocketUrl: startResponse.value.websocketUrl,
            sessionId: `session-${Date.now()}`,
        };
        // Initialize audio manager
        console.log("🎤 Initializing audio...");
        geminiLive.audioManager = createAudioStreamManager();
        // Initialize WebSocket client FIRST
        console.log("🔌 Connecting to Gemini Live...");
        geminiLive.wsClient = createWebSocketClient({
            url: geminiLive.credentials.websocketUrl,
            reconnectAttempts: 3,
            reconnectDelay: 1000,
        });
        // Setup WebSocket event handlers
        geminiLive.wsClient.onMessage(messageHandler);
        geminiLive.wsClient.onStatusChange((status) => {
            console.log("📡 WebSocket status:", status);
            if (status === 'error') {
                console.error("❌ WebSocket connection error");
            }
        });
        geminiLive.wsClient.onError((error) => {
            console.error("❌ WebSocket error:", error);
        });
        // Connect to Gemini Live
        await geminiLive.wsClient.connect(geminiLive.credentials);
        // Wait a bit for the connection to stabilize
        await new Promise(resolve => setTimeout(resolve, 100));
        // Convert OpenAI tools to Gemini Live format and send initial setup message
        const openaiTools = pluginTools(startResponse.value);
        const geminiTools = ToolAdapter.convertToolsToGemini(openaiTools);
        const setupMessage = createGeminiLiveSetupMessage(systemPrompt.value, geminiTools);
        console.log("📤 Sending Gemini Live setup message:", JSON.stringify(setupMessage, null, 2));
        await geminiLive.wsClient.sendMessage(setupMessage);
        // Wait for setup to complete
        await new Promise(resolve => setTimeout(resolve, 200));
        // Setup audio input
        console.log("🎤 Setting up audio input...");
        await geminiLive.audioManager.setupInput();
        // Setup audio output
        if (audioEl.value) {
            await geminiLive.audioManager.setupOutput();
        }
        // Start audio streaming
        await geminiLive.audioManager.startStreaming();
        console.log("🎤 Audio streaming started");
        // Setup audio data streaming
        if (geminiLive.audioManager) {
            geminiLive.audioManager.onAudioData(async (audioData) => {
                if (!audioData || audioData.length === 0) {
                    return;
                }
                // Update local microphone visualisation regardless of WebSocket status
                let sum = 0;
                for (let i = 0; i < audioData.length; i += 1) {
                    const sample = audioData[i];
                    sum += sample * sample;
                }
                const rms = Math.sqrt(sum / audioData.length);
                const level = Math.min(1, rms * 12);
                micLevel.value = level;
                const nextWave = micWaveform.value.slice(-MAX_WAVEFORM_POINTS + 1);
                nextWave.push(level);
                micWaveform.value = nextWave;
                if (geminiLive.wsClient && geminiLive.wsClient.isConnected.value) {
                    try {
                        const audioBase64 = arrayBufferToBase64(audioData.buffer);
                        const audioMessage = {
                            realtimeInput: {
                                audio: {
                                    mimeType: 'audio/raw;encoding=pcm16;rate=16000',
                                    data: audioBase64,
                                },
                            },
                        };
                        await geminiLive.wsClient.sendMessage(audioMessage);
                        console.log("🎵 Audio data sent to Gemini Live:", audioData.length);
                    }
                    catch (error) {
                        console.error("❌ Failed to stream audio chunk:", error);
                    }
                }
            });
        }
        // Start local speech recognition for transcription
        startSpeechRecognition();
        chatActive.value = true;
        console.log("✅ Gemini Live session started successfully");
    }
    catch (err) {
        console.error("❌ Failed to start Gemini Live session:", err);
        stopChat();
        alert(`Failed to start voice chat: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    finally {
        connecting.value = false;
    }
}
function startSpeechRecognition() {
    try {
        // Check if Web Speech API is available
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn("⚠️ Speech Recognition API not supported in this browser");
            return;
        }
        const recognitionInstance = new SpeechRecognition();
        recognition.value = recognitionInstance;
        recognitionInstance.continuous = true;
        recognitionInstance.interimResults = true;
        recognitionInstance.lang = 'ja-JP'; // 日本語設定、必要に応じて変更可能
        recognitionInstance.onstart = () => {
            isRecognizing.value = true;
            console.log("🎤 Speech recognition started");
        };
        recognitionInstance.onresult = (event) => {
            let interim = "";
            let final = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                }
                else {
                    interim += transcript;
                }
            }
            if (final) {
                localTranscript.value = final;
                messages.value.push(`You (voice): ${final}`);
                console.log("🎤 Final transcript:", final);
                // Clear interim after final result
                interimTranscript.value = "";
            }
            else {
                interimTranscript.value = interim;
            }
        };
        recognitionInstance.onerror = (event) => {
            console.error("❌ Speech recognition error:", event.error);
            if (event.error === 'no-speech') {
                console.log("ℹ️ No speech detected, continuing...");
            }
        };
        recognitionInstance.onend = () => {
            isRecognizing.value = false;
            console.log("🎤 Speech recognition ended");
            // Restart if chat is still active
            if (chatActive.value) {
                setTimeout(() => {
                    if (chatActive.value && recognition.value) {
                        try {
                            recognition.value.start();
                        }
                        catch (e) {
                            console.warn("⚠️ Could not restart speech recognition:", e);
                        }
                    }
                }, 100);
            }
        };
        recognitionInstance.start();
        console.log("🎤 Speech recognition initialized");
    }
    catch (error) {
        console.error("❌ Failed to initialize speech recognition:", error);
    }
}
function stopSpeechRecognition() {
    if (recognition.value) {
        try {
            recognition.value.stop();
            recognition.value = null;
            isRecognizing.value = false;
            localTranscript.value = "";
            interimTranscript.value = "";
            console.log("🎤 Speech recognition stopped");
        }
        catch (error) {
            console.error("❌ Failed to stop speech recognition:", error);
        }
    }
}
async function sendTextMessage() {
    const text = userInput.value.trim();
    if (!text)
        return;
    if (!chatActive.value || !geminiLive.wsClient || !geminiLive.wsClient.isConnected.value) {
        console.warn("Cannot send text message because WebSocket is not connected");
        return;
    }
    try {
        // Send text message to Gemini Live
        const textMessage = createTextInputMessage(text);
        await geminiLive.wsClient.sendMessage(textMessage);
        // Add to local message history
        messages.value.push(`You: ${text}`);
        userInput.value = "";
        console.log("📤 Text message sent:", text);
    }
    catch (error) {
        console.error("❌ Failed to send text message:", error);
    }
}
// Utility function for audio data conversion
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
// Function to play audio from base64 data
async function playAudioFromBase64(base64Data) {
    try {
        // Convert base64 to blob
        const binaryString = atob(base64Data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const audioBlob = new Blob([bytes], { type: 'audio/pcm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        // Create and play audio element
        const audio = new Audio(audioUrl);
        audio.addEventListener('ended', () => {
            URL.revokeObjectURL(audioUrl);
        });
        await audio.play();
        console.log("🔊 Audio playback started");
    }
    catch (error) {
        console.error("❌ Failed to play audio:", error);
    }
}
async function stopChat() {
    try {
        // Stop speech recognition
        stopSpeechRecognition();
        // Disconnect WebSocket
        if (geminiLive.wsClient) {
            await geminiLive.wsClient.disconnect();
            geminiLive.wsClient = null;
        }
        // Stop audio streaming
        if (geminiLive.audioManager) {
            await geminiLive.audioManager.stopStreaming();
            geminiLive.audioManager = null;
        }
        // Clear audio element
        if (audioEl.value) {
            audioEl.value.srcObject = null;
        }
        // Clear session credentials
        geminiLive.credentials = null;
        chatActive.value = false;
        console.log("🔌 Gemini Live session stopped");
    }
    catch (error) {
        console.error("❌ Error stopping chat:", error);
        chatActive.value = false;
    }
}
debugger; /* PartiallyEnd: #3632/scriptSetup.vue */
const __VLS_ctx = {};
let __VLS_elements;
let __VLS_components;
let __VLS_directives;
// CSS variable injection 
// CSS variable injection end 
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "p-4 space-y-4" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    role: "toolbar",
    ...{ class: "flex justify-between items-center" },
});
__VLS_asFunctionalElement(__VLS_elements.h1, __VLS_elements.h1)({
    ...{ class: "text-2xl font-bold" },
});
__VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({
    ...{ class: "text-sm text-gray-500 font-normal" },
});
__VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
    ...{ onClick: (...[$event]) => {
            __VLS_ctx.showConfigPopup = true;
            // @ts-ignore
            [showConfigPopup,];
        } },
    ...{ class: "p-2 bg-gray-600 text-white rounded hover:bg-gray-700" },
    title: "Configuration",
});
__VLS_asFunctionalElement(__VLS_elements.svg, __VLS_elements.svg)({
    ...{ class: "w-5 h-5" },
    fill: "currentColor",
    viewBox: "0 0 20 20",
});
__VLS_asFunctionalElement(__VLS_elements.path)({
    'fill-rule': "evenodd",
    d: "M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z",
    'clip-rule': "evenodd",
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "flex space-x-4" },
    ...{ style: {} },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "w-[30%] bg-gray-50 border rounded p-4 flex flex-col space-y-4" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "space-y-2 flex-shrink-0" },
});
if (!__VLS_ctx.chatActive) {
    // @ts-ignore
    [chatActive,];
    __VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
        ...{ onClick: (__VLS_ctx.startChat) },
        disabled: (__VLS_ctx.connecting),
        ...{ class: "w-full px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50" },
    });
    // @ts-ignore
    [startChat, connecting,];
    (__VLS_ctx.connecting ? "Connecting..." : "Start Voice Chat");
    // @ts-ignore
    [connecting,];
}
else {
    __VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
        ...{ onClick: (__VLS_ctx.stopChat) },
        ...{ class: "w-full px-4 py-2 bg-red-600 text-white rounded" },
    });
    // @ts-ignore
    [stopChat,];
}
__VLS_asFunctionalElement(__VLS_elements.audio, __VLS_elements.audio)({
    ref: "audioEl",
    autoplay: true,
});
/** @type {typeof __VLS_ctx.audioEl} */ ;
// @ts-ignore
[audioEl,];
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "space-y-1" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "text-xs text-gray-500 uppercase tracking-wide flex items-center justify-between" },
});
__VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({});
if (__VLS_ctx.isRecognizing) {
    // @ts-ignore
    [isRecognizing,];
    __VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({
        ...{ class: "text-green-600 animate-pulse" },
    });
}
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "h-2 bg-gray-200 rounded overflow-hidden" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "h-full bg-green-500 transition-all duration-100" },
    ...{ style: ({ width: `${Math.round(__VLS_ctx.micLevel * 100)}%` }) },
});
// @ts-ignore
[micLevel,];
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "h-12 flex items-end space-x-1" },
});
for (const [level, index] of __VLS_getVForSourceType((__VLS_ctx.micWaveform))) {
    // @ts-ignore
    [micWaveform,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        key: (index),
        ...{ class: "w-1 bg-green-400 rounded-t" },
        ...{ style: ({ height: `${Math.max(4, Math.round(level * 100))}%` }) },
    });
}
if (!__VLS_ctx.micWaveform.length) {
    // @ts-ignore
    [micWaveform,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "text-xs text-gray-400" },
    });
}
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "flex-1 flex flex-col min-h-0" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ref: "imageContainer",
    ...{ class: "border rounded p-2 overflow-y-auto space-y-2 flex-1" },
});
/** @type {typeof __VLS_ctx.imageContainer} */ ;
// @ts-ignore
[imageContainer,];
if (!__VLS_ctx.pluginResults.length && !__VLS_ctx.isGeneratingImage) {
    // @ts-ignore
    [pluginResults, isGeneratingImage,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "text-gray-500 text-sm" },
    });
}
for (const [result, index] of __VLS_getVForSourceType((__VLS_ctx.pluginResults))) {
    // @ts-ignore
    [pluginResults,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ onClick: (...[$event]) => {
                __VLS_ctx.selectedResult = result;
                __VLS_ctx.scrollCurrentResultToTop();
                ;
                // @ts-ignore
                [selectedResult, scrollCurrentResultToTop,];
            } },
        key: (index),
        ...{ class: "cursor-pointer hover:opacity-75 transition-opacity border rounded p-2" },
        ...{ class: ({ 'ring-2 ring-blue-500': __VLS_ctx.selectedResult === result }) },
    });
    // @ts-ignore
    [selectedResult,];
    if (result.imageData) {
        __VLS_asFunctionalElement(__VLS_elements.img)({
            src: (`data:image/png;base64,${result.imageData}`),
            ...{ class: "max-w-full h-auto rounded" },
            alt: "Generated image",
        });
    }
    else if (result.url) {
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center p-4 bg-blue-50 rounded" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-blue-600 font-medium" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-xs text-gray-600 mt-1 truncate" },
        });
        (result.title || result.url);
    }
    else if (result.htmlData) {
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center p-4 bg-green-50 rounded" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-green-600 font-medium" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-xs text-gray-600 mt-1 truncate" },
        });
        (result.title || "Interactive content");
    }
    else if (result.location) {
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center p-4 bg-blue-50 rounded" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-blue-600 font-medium" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-xs text-gray-600 mt-1 truncate" },
        });
        (typeof result.location === "string"
            ? result.location
            : `${result.location.lat}, ${result.location.lng}`);
    }
    else {
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center p-4 bg-gray-50 rounded" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-gray-600 font-medium" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-xs text-gray-500 mt-1 truncate" },
        });
        (result.message);
    }
}
if (__VLS_ctx.isGeneratingImage) {
    // @ts-ignore
    [isGeneratingImage,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "flex items-center justify-center py-4" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" },
    });
    __VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({
        ...{ class: "ml-2 text-sm text-gray-600" },
    });
    (__VLS_ctx.generatingMessage);
    // @ts-ignore
    [generatingMessage,];
}
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "space-y-2 flex-shrink-0" },
});
__VLS_asFunctionalElement(__VLS_elements.input)({
    ...{ onKeyup: (__VLS_ctx.sendTextMessage) },
    value: (__VLS_ctx.userInput),
    disabled: (!__VLS_ctx.chatActive),
    type: "text",
    placeholder: "Type a message",
    ...{ class: "w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50" },
});
// @ts-ignore
[chatActive, sendTextMessage, userInput,];
__VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
    ...{ onClick: (__VLS_ctx.sendTextMessage) },
    disabled: (!__VLS_ctx.chatActive || !__VLS_ctx.userInput.trim()),
    ...{ class: "w-full px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50" },
});
// @ts-ignore
[chatActive, sendTextMessage, userInput,];
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "flex-1 flex flex-col space-y-4" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "h-48 border rounded bg-white p-4 overflow-y-auto" },
});
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "space-y-2" },
});
if (__VLS_ctx.messages.length === 0) {
    // @ts-ignore
    [messages,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "text-gray-400 text-sm italic" },
    });
}
for (const [message, index] of __VLS_getVForSourceType((__VLS_ctx.messages))) {
    // @ts-ignore
    [messages,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        key: (index),
        ...{ class: "p-2 rounded" },
        ...{ class: ({
                'bg-blue-50 text-blue-900': message.startsWith('You'),
                'bg-gray-50 text-gray-900': message.startsWith('Assistant'),
                'bg-gray-100 text-gray-700': !message.startsWith('You') && !message.startsWith('Assistant')
            }) },
    });
    (message);
}
if (__VLS_ctx.currentText) {
    // @ts-ignore
    [currentText,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "p-2 rounded bg-gray-50 text-gray-900" },
    });
    __VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({
        ...{ class: "font-medium" },
    });
    (__VLS_ctx.currentText);
    // @ts-ignore
    [currentText,];
}
if (__VLS_ctx.interimTranscript) {
    // @ts-ignore
    [interimTranscript,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "p-2 rounded bg-blue-100 text-blue-700 italic" },
    });
    __VLS_asFunctionalElement(__VLS_elements.span, __VLS_elements.span)({
        ...{ class: "font-medium" },
    });
    (__VLS_ctx.interimTranscript);
    // @ts-ignore
    [interimTranscript,];
}
__VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
    ...{ class: "flex-1 border rounded bg-gray-50 overflow-hidden" },
});
if (__VLS_ctx.selectedResult?.url && __VLS_ctx.isTwitterUrl(__VLS_ctx.selectedResult.url)) {
    // @ts-ignore
    [selectedResult, selectedResult, isTwitterUrl,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "w-full h-full overflow-auto p-4 bg-white" },
    });
    if (__VLS_ctx.twitterEmbedData[__VLS_ctx.selectedResult.url]) {
        // @ts-ignore
        [selectedResult, twitterEmbedData,];
        __VLS_asFunctionalElement(__VLS_elements.div)({});
        __VLS_asFunctionalDirective(__VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.twitterEmbedData[__VLS_ctx.selectedResult.url]) }, null, null);
        // @ts-ignore
        [selectedResult, twitterEmbedData,];
    }
    else if (__VLS_ctx.twitterEmbedData[__VLS_ctx.selectedResult.url] === null) {
        // @ts-ignore
        [selectedResult, twitterEmbedData,];
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "h-full flex items-center justify-center" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-gray-600 mb-4" },
        });
        __VLS_asFunctionalElement(__VLS_elements.a, __VLS_elements.a)({
            href: (__VLS_ctx.selectedResult.url),
            target: "_blank",
            ...{ class: "inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors" },
        });
        // @ts-ignore
        [selectedResult,];
    }
    else {
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "h-full flex items-center justify-center" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-center" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2" },
        });
        __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
            ...{ class: "text-gray-600" },
        });
    }
}
else if (__VLS_ctx.selectedResult?.url) {
    // @ts-ignore
    [selectedResult,];
    __VLS_asFunctionalElement(__VLS_elements.iframe)({
        src: (__VLS_ctx.selectedResult.url),
        ...{ class: "w-full h-full rounded" },
        frameborder: "0",
    });
    // @ts-ignore
    [selectedResult,];
}
else if (__VLS_ctx.selectedResult?.htmlData) {
    // @ts-ignore
    [selectedResult,];
    __VLS_asFunctionalElement(__VLS_elements.div)({
        ...{ class: "w-full h-full overflow-auto p-4 bg-white" },
    });
    __VLS_asFunctionalDirective(__VLS_directives.vHtml)(null, { ...__VLS_directiveBindingRestFields, value: (__VLS_ctx.selectedResult.htmlData) }, null, null);
    // @ts-ignore
    [selectedResult,];
}
else if (__VLS_ctx.selectedResult?.imageData) {
    // @ts-ignore
    [selectedResult,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "w-full h-full flex items-center justify-center p-4" },
    });
    __VLS_asFunctionalElement(__VLS_elements.img)({
        src: (`data:image/png;base64,${__VLS_ctx.selectedResult.imageData}`),
        ...{ class: "max-w-full max-h-full object-contain rounded" },
        alt: "Current generated image",
    });
    // @ts-ignore
    [selectedResult,];
}
else if (__VLS_ctx.selectedResult?.location && __VLS_ctx.googleMapKey) {
    // @ts-ignore
    [selectedResult, googleMapKey,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "w-full h-full p-4" },
    });
    /** @type {[typeof GoogleMap, ]} */ ;
    // @ts-ignore
    const __VLS_0 = __VLS_asFunctionalComponent(GoogleMap, new GoogleMap({
        location: (__VLS_ctx.selectedResult.location),
        apiKey: (__VLS_ctx.googleMapKey),
        zoom: (15),
    }));
    const __VLS_1 = __VLS_0({
        location: (__VLS_ctx.selectedResult.location),
        apiKey: (__VLS_ctx.googleMapKey),
        zoom: (15),
    }, ...__VLS_functionalComponentArgsRest(__VLS_0));
    // @ts-ignore
    [selectedResult, googleMapKey,];
}
else {
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "w-full h-full flex items-center justify-center" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "text-gray-400 text-lg" },
    });
}
if (__VLS_ctx.showConfigPopup) {
    // @ts-ignore
    [showConfigPopup,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showConfigPopup))
                    return;
                __VLS_ctx.showConfigPopup = false;
                // @ts-ignore
                [showConfigPopup,];
            } },
        ...{ class: "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "bg-white rounded-lg p-6 max-w-md w-full mx-4" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "flex justify-between items-center mb-4" },
    });
    __VLS_asFunctionalElement(__VLS_elements.h2, __VLS_elements.h2)({
        ...{ class: "text-xl font-semibold" },
    });
    __VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showConfigPopup))
                    return;
                __VLS_ctx.showConfigPopup = false;
                // @ts-ignore
                [showConfigPopup,];
            } },
        ...{ class: "text-gray-500 hover:text-gray-700" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "space-y-4" },
    });
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({});
    __VLS_asFunctionalElement(__VLS_elements.label, __VLS_elements.label)({
        ...{ class: "block text-sm font-medium text-gray-700 mb-2" },
    });
    __VLS_asFunctionalElement(__VLS_elements.textarea, __VLS_elements.textarea)({
        value: (__VLS_ctx.systemPrompt),
        placeholder: "You are a helpful assistant.",
        ...{ class: "w-full border rounded px-3 py-2 h-32 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" },
    });
    // @ts-ignore
    [systemPrompt,];
    __VLS_asFunctionalElement(__VLS_elements.div, __VLS_elements.div)({
        ...{ class: "flex justify-end" },
    });
    __VLS_asFunctionalElement(__VLS_elements.button, __VLS_elements.button)({
        ...{ onClick: (...[$event]) => {
                if (!(__VLS_ctx.showConfigPopup))
                    return;
                __VLS_ctx.showConfigPopup = false;
                // @ts-ignore
                [showConfigPopup,];
            } },
        ...{ class: "px-4 py-2 text-gray-600 hover:text-gray-800" },
    });
}
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-between']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-2xl']} */ ;
/** @type {__VLS_StyleScopedClasses['font-bold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-500']} */ ;
/** @type {__VLS_StyleScopedClasses['font-normal']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['text-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:bg-gray-700']} */ ;
/** @type {__VLS_StyleScopedClasses['w-5']} */ ;
/** @type {__VLS_StyleScopedClasses['h-5']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['space-x-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-[30%]']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-50']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-4']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-shrink-0']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-green-600']} */ ;
/** @type {__VLS_StyleScopedClasses['text-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['disabled:opacity-50']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-red-600']} */ ;
/** @type {__VLS_StyleScopedClasses['text-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-1']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-500']} */ ;
/** @type {__VLS_StyleScopedClasses['uppercase']} */ ;
/** @type {__VLS_StyleScopedClasses['tracking-wide']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-between']} */ ;
/** @type {__VLS_StyleScopedClasses['text-green-600']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-pulse']} */ ;
/** @type {__VLS_StyleScopedClasses['h-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-200']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-hidden']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-green-500']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-all']} */ ;
/** @type {__VLS_StyleScopedClasses['duration-100']} */ ;
/** @type {__VLS_StyleScopedClasses['h-12']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-end']} */ ;
/** @type {__VLS_StyleScopedClasses['space-x-1']} */ ;
/** @type {__VLS_StyleScopedClasses['w-1']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-green-400']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-t']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-400']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['min-h-0']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-y-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-500']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['cursor-pointer']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:opacity-75']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-opacity']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['ring-2']} */ ;
/** @type {__VLS_StyleScopedClasses['ring-blue-500']} */ ;
/** @type {__VLS_StyleScopedClasses['max-w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-50']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['truncate']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-green-50']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-green-600']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['truncate']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-50']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['truncate']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-50']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xs']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-500']} */ ;
/** @type {__VLS_StyleScopedClasses['mt-1']} */ ;
/** @type {__VLS_StyleScopedClasses['truncate']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['py-4']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-spin']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-8']} */ ;
/** @type {__VLS_StyleScopedClasses['w-8']} */ ;
/** @type {__VLS_StyleScopedClasses['border-b-2']} */ ;
/** @type {__VLS_StyleScopedClasses['border-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['ml-2']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-2']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-shrink-0']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:outline-none']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:ring-2']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:ring-blue-500']} */ ;
/** @type {__VLS_StyleScopedClasses['disabled:opacity-50']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['text-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['disabled:opacity-50']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-col']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-4']} */ ;
/** @type {__VLS_StyleScopedClasses['h-48']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-y-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-2']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-400']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['italic']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-50']} */ ;
/** @type {__VLS_StyleScopedClasses['text-blue-900']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-50']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-900']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-100']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-700']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-50']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-900']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['p-2']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-100']} */ ;
/** @type {__VLS_StyleScopedClasses['text-blue-700']} */ ;
/** @type {__VLS_StyleScopedClasses['italic']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['flex-1']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-gray-50']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-hidden']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['inline-block']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['text-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:bg-blue-700']} */ ;
/** @type {__VLS_StyleScopedClasses['transition-colors']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-center']} */ ;
/** @type {__VLS_StyleScopedClasses['animate-spin']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-8']} */ ;
/** @type {__VLS_StyleScopedClasses['w-8']} */ ;
/** @type {__VLS_StyleScopedClasses['border-b-2']} */ ;
/** @type {__VLS_StyleScopedClasses['border-blue-600']} */ ;
/** @type {__VLS_StyleScopedClasses['mx-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-2']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['overflow-auto']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['max-w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['max-h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['object-contain']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['p-4']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['h-full']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-400']} */ ;
/** @type {__VLS_StyleScopedClasses['text-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['fixed']} */ ;
/** @type {__VLS_StyleScopedClasses['inset-0']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-black']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-opacity-50']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-center']} */ ;
/** @type {__VLS_StyleScopedClasses['z-50']} */ ;
/** @type {__VLS_StyleScopedClasses['bg-white']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded-lg']} */ ;
/** @type {__VLS_StyleScopedClasses['p-6']} */ ;
/** @type {__VLS_StyleScopedClasses['max-w-md']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['mx-4']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-between']} */ ;
/** @type {__VLS_StyleScopedClasses['items-center']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-4']} */ ;
/** @type {__VLS_StyleScopedClasses['text-xl']} */ ;
/** @type {__VLS_StyleScopedClasses['font-semibold']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-500']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:text-gray-700']} */ ;
/** @type {__VLS_StyleScopedClasses['space-y-4']} */ ;
/** @type {__VLS_StyleScopedClasses['block']} */ ;
/** @type {__VLS_StyleScopedClasses['text-sm']} */ ;
/** @type {__VLS_StyleScopedClasses['font-medium']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-700']} */ ;
/** @type {__VLS_StyleScopedClasses['mb-2']} */ ;
/** @type {__VLS_StyleScopedClasses['w-full']} */ ;
/** @type {__VLS_StyleScopedClasses['border']} */ ;
/** @type {__VLS_StyleScopedClasses['rounded']} */ ;
/** @type {__VLS_StyleScopedClasses['px-3']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['h-32']} */ ;
/** @type {__VLS_StyleScopedClasses['resize-none']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:outline-none']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:ring-2']} */ ;
/** @type {__VLS_StyleScopedClasses['focus:ring-blue-500']} */ ;
/** @type {__VLS_StyleScopedClasses['flex']} */ ;
/** @type {__VLS_StyleScopedClasses['justify-end']} */ ;
/** @type {__VLS_StyleScopedClasses['px-4']} */ ;
/** @type {__VLS_StyleScopedClasses['py-2']} */ ;
/** @type {__VLS_StyleScopedClasses['text-gray-600']} */ ;
/** @type {__VLS_StyleScopedClasses['hover:text-gray-800']} */ ;
var __VLS_dollars;
const __VLS_self = (await import('vue')).defineComponent({
    setup: () => ({
        GoogleMap: GoogleMap,
        audioEl: audioEl,
        imageContainer: imageContainer,
        connecting: connecting,
        systemPrompt: systemPrompt,
        messages: messages,
        currentText: currentText,
        pluginResults: pluginResults,
        isGeneratingImage: isGeneratingImage,
        generatingMessage: generatingMessage,
        showConfigPopup: showConfigPopup,
        selectedResult: selectedResult,
        userInput: userInput,
        twitterEmbedData: twitterEmbedData,
        googleMapKey: googleMapKey,
        micLevel: micLevel,
        micWaveform: micWaveform,
        chatActive: chatActive,
        isRecognizing: isRecognizing,
        interimTranscript: interimTranscript,
        scrollCurrentResultToTop: scrollCurrentResultToTop,
        isTwitterUrl: isTwitterUrl,
        startChat: startChat,
        sendTextMessage: sendTextMessage,
        stopChat: stopChat,
    }),
});
export default (await import('vue')).defineComponent({});
; /* PartiallyEnd: #4569/main.vue */
