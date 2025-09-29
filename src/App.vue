<template>
  <div class="p-4 space-y-4">
    <div role="toolbar" class="flex justify-between items-center">
      <h1 class="text-2xl font-bold">
        MulmoChat
        <span class="text-sm text-gray-500 font-normal">Multi-modal Chat</span>
      </h1>
      <button
        @click="showConfigPopup = true"
        class="p-2 bg-gray-600 text-white rounded hover:bg-gray-700"
        title="Configuration"
      >
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path
            fill-rule="evenodd"
            d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
            clip-rule="evenodd"
          />
        </svg>
      </button>
    </div>

    <!-- Main content area with sidebar -->
    <div class="flex space-x-4" style="height: calc(100vh - 80px)">
      <!-- Sidebar -->
      <div
        class="w-[30%] bg-gray-50 border rounded p-4 flex flex-col space-y-4"
      >
        <!-- Voice chat controls -->
        <div class="space-y-2 flex-shrink-0">
          <button
            v-if="!chatActive"
            @click="startChat"
            :disabled="connecting"
            class="w-full px-4 py-2 bg-green-600 text-white rounded disabled:opacity-50"
          >
            {{ connecting ? "Connecting..." : "Start Voice Chat" }}
          </button>
          <button
            v-else
            @click="stopChat"
            class="w-full px-4 py-2 bg-red-600 text-white rounded"
          >
            Stop Voice Chat
          </button>
          <audio ref="audioEl" autoplay></audio>
          <div class="space-y-1">
            <div class="text-xs text-gray-500 uppercase tracking-wide flex items-center justify-between">
              <span>Mic Input</span>
              <span v-if="isRecognizing" class="text-green-600 animate-pulse">● Recognizing</span>
            </div>
            <div class="h-2 bg-gray-200 rounded overflow-hidden">
              <div
                class="h-full bg-green-500 transition-all duration-100"
                :style="{ width: `${Math.round(micLevel * 100)}%` }"
              ></div>
            </div>
            <div class="h-12 flex items-end space-x-1">
              <div
                v-for="(level, index) in micWaveform"
                :key="index"
                class="w-1 bg-green-400 rounded-t"
                :style="{ height: `${Math.max(4, Math.round(level * 100))}%` }"
              ></div>
              <div v-if="!micWaveform.length" class="text-xs text-gray-400">Speak to see levels…</div>
            </div>
          </div>
        </div>

        <!-- Generated images container -->
        <div class="flex-1 flex flex-col min-h-0">
          <div
            ref="imageContainer"
            class="border rounded p-2 overflow-y-auto space-y-2 flex-1"
          >
            <div
              v-if="!pluginResults.length && !isGeneratingImage"
              class="text-gray-500 text-sm"
            >
              Feel free to ask me any questions...
            </div>
            <div
              v-for="(result, index) in pluginResults"
              :key="index"
              class="cursor-pointer hover:opacity-75 transition-opacity border rounded p-2"
              :class="{ 'ring-2 ring-blue-500': selectedResult === result }"
              @click="
                selectedResult = result;
                scrollCurrentResultToTop();
              "
            >
              <img
                v-if="result.imageData"
                :src="`data:image/png;base64,${result.imageData}`"
                class="max-w-full h-auto rounded"
                alt="Generated image"
              />
              <div
                v-else-if="result.url"
                class="text-center p-4 bg-blue-50 rounded"
              >
                <div class="text-blue-600 font-medium">🌐 Web Page</div>
                <div class="text-xs text-gray-600 mt-1 truncate">
                  {{ result.title || result.url }}
                </div>
              </div>
              <div
                v-else-if="result.htmlData"
                class="text-center p-4 bg-green-50 rounded"
              >
                <div class="text-green-600 font-medium">📄 Presentation</div>
                <div class="text-xs text-gray-600 mt-1 truncate">
                  {{ result.title || "Interactive content" }}
                </div>
              </div>
              <div
                v-else-if="result.location"
                class="text-center p-4 bg-blue-50 rounded"
              >
                <div class="text-blue-600 font-medium">🗺️ Map Location</div>
                <div class="text-xs text-gray-600 mt-1 truncate">
                  {{
                    typeof result.location === "string"
                      ? result.location
                      : `${result.location.lat}, ${result.location.lng}`
                  }}
                </div>
              </div>
              <div v-else class="text-center p-4 bg-gray-50 rounded">
                <div class="text-gray-600 font-medium">📋 Text Result</div>
                <div class="text-xs text-gray-500 mt-1 truncate">
                  {{ result.message }}
                </div>
              </div>
            </div>
            <div
              v-if="isGeneratingImage"
              class="flex items-center justify-center py-4"
            >
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"
              ></div>
              <span class="ml-2 text-sm text-gray-600">{{
                generatingMessage
              }}</span>
            </div>
          </div>
        </div>

        <div class="space-y-2 flex-shrink-0">
          <input
            v-model="userInput"
            @keyup.enter.prevent="sendTextMessage"
            :disabled="!chatActive"
            type="text"
            placeholder="Type a message"
            class="w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            @click="sendTextMessage"
            :disabled="!chatActive || !userInput.trim()"
            class="w-full px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
          >
            Send Message
          </button>
        </div>
      </div>

      <!-- Main content -->
      <div class="flex-1 flex flex-col space-y-4">
        <!-- Conversation Messages -->
        <div class="h-48 border rounded bg-white p-4 overflow-y-auto">
          <div class="space-y-2">
            <div v-if="messages.length === 0" class="text-gray-400 text-sm italic">
              Conversation will appear here...
            </div>
            <div
              v-for="(message, index) in messages"
              :key="index"
              class="p-2 rounded"
              :class="{
                'bg-blue-50 text-blue-900': message.startsWith('You'),
                'bg-gray-50 text-gray-900': message.startsWith('Assistant'),
                'bg-gray-100 text-gray-700': !message.startsWith('You') && !message.startsWith('Assistant')
              }"
            >
              {{ message }}
            </div>
            <div v-if="currentText" class="p-2 rounded bg-gray-50 text-gray-900">
              <span class="font-medium">Assistant:</span> {{ currentText }}...
            </div>
            <div v-if="interimTranscript" class="p-2 rounded bg-blue-100 text-blue-700 italic">
              <span class="font-medium">You (speaking):</span> {{ interimTranscript }}...
            </div>
          </div>
        </div>

        <div class="flex-1 border rounded bg-gray-50 overflow-hidden">
          <div
            v-if="selectedResult?.url && isTwitterUrl(selectedResult.url)"
            class="w-full h-full overflow-auto p-4 bg-white"
          >
            <div
              v-if="twitterEmbedData[selectedResult.url]"
              v-html="twitterEmbedData[selectedResult.url]"
            />
            <div
              v-else-if="twitterEmbedData[selectedResult.url] === null"
              class="h-full flex items-center justify-center"
            >
              <div class="text-center">
                <div class="text-gray-600 mb-4">
                  Unable to load Twitter embed
                </div>
                <a
                  :href="selectedResult.url"
                  target="_blank"
                  class="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  Open on Twitter/X
                </a>
              </div>
            </div>
            <div v-else class="h-full flex items-center justify-center">
              <div class="text-center">
                <div
                  class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"
                ></div>
                <div class="text-gray-600">Loading Twitter embed...</div>
              </div>
            </div>
          </div>
          <iframe
            v-else-if="selectedResult?.url"
            :src="selectedResult.url"
            class="w-full h-full rounded"
            frameborder="0"
          />
          <div
            v-else-if="selectedResult?.htmlData"
            class="w-full h-full overflow-auto p-4 bg-white"
            v-html="selectedResult.htmlData"
          />
          <div
            v-else-if="selectedResult?.imageData"
            class="w-full h-full flex items-center justify-center p-4"
          >
            <img
              :src="`data:image/png;base64,${selectedResult.imageData}`"
              class="max-w-full max-h-full object-contain rounded"
              alt="Current generated image"
            />
          </div>
          <div
            v-else-if="selectedResult?.location && googleMapKey"
            class="w-full h-full p-4"
          >
            <GoogleMap
              :location="selectedResult.location"
              :api-key="googleMapKey"
              :zoom="15"
            />
          </div>
          <div v-else class="w-full h-full flex items-center justify-center">
            <div class="text-gray-400 text-lg">Canvas</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Config Popup -->
    <div
      v-if="showConfigPopup"
      class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      @click.self="showConfigPopup = false"
    >
      <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-semibold">Configuration</h2>
          <button
            @click="showConfigPopup = false"
            class="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>

        <div class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">
              System Prompt
            </label>
            <textarea
              v-model="systemPrompt"
              placeholder="You are a helpful assistant."
              class="w-full border rounded px-3 py-2 h-32 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            ></textarea>
          </div>

          <div class="flex justify-end">
            <button
              @click="showConfigPopup = false"
              class="px-4 py-2 text-gray-600 hover:text-gray-800"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import {
  pluginTools,
  pluginExecute,
  PluginContext,
  PluginResult,
  pluginGeneratingMessage,
  pluginWaitingMessage,
} from "./plugins/type";

// Web Speech API types
interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onstart: ((this: SpeechRecognition, ev: Event) => any) | null;
  onend: ((this: SpeechRecognition, ev: Event) => any) | null;
  onerror: ((this: SpeechRecognition, ev: any) => any) | null;
  onresult: ((this: SpeechRecognition, ev: any) => any) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
import type { StartApiResponse } from "../server/types";
// @ts-ignore
import GoogleMap from "./components/GoogleMap.vue";
import {
  createWebSocketClient,
  createGeminiLiveSetupMessage,
  createTextInputMessage,
  type WebSocketClient,
  type GeminiLiveMessage,
  type SessionCredentials
} from "./services/webSocketClient";
import {
  createAudioStreamManager,
  checkAudioSupport,
  type AudioStreamManager
} from "./services/audioStreamManager";
import {
  ToolAdapter,
  ToolUtils,
  type GeminiToolCall
} from "./services/toolAdapter";

const SYSTEM_PROMPT_KEY = "system_prompt_v2";
const DEFAULT_SYSTEM_PROMPT =
  "You are a teacher who explains various things in a way that even middle school students can easily understand. When words alone are not enough, you MUST use the generateImage API to draw pictures and use them to help explain. When you are talking about places, objects, people, movies, books and other things, you MUST use the generateImage API to draw pictures to make the conversation more engaging.";
const audioEl = ref<HTMLAudioElement | null>(null);
const imageContainer = ref<HTMLDivElement | null>(null);
const connecting = ref(false);
const systemPrompt = ref(
  localStorage.getItem(SYSTEM_PROMPT_KEY) || DEFAULT_SYSTEM_PROMPT,
);
const messages = ref<string[]>([]);
const currentText = ref("");
const pluginResults = ref<PluginResult[]>([]);
const isGeneratingImage = ref(false);
const generatingMessage = ref("");
const pendingToolArgs: Record<string, string> = {};
const showConfigPopup = ref(false);
const selectedResult = ref<PluginResult | null>(null);
const userInput = ref("");
const twitterEmbedData = ref<Record<string, string | null>>({});
const googleMapKey = ref<string | null>(null);
const startResponse = ref<StartApiResponse | null>(null);
const micLevel = ref(0);
const micWaveform = ref<number[]>([]);
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
  wsClient: null as WebSocketClient | null,
  audioManager: null as AudioStreamManager | null,
  credentials: null as SessionCredentials | null,
};

// Speech Recognition for local transcription
const recognition = ref<SpeechRecognition | null>(null);
const isRecognizing = ref(false);
const localTranscript = ref("");
const interimTranscript = ref("");

type InlineAudioData = {
  mimeType?: string;
  data?: string;
};

interface GeminiServerContentPart {
  text?: string;
  inlineData?: InlineAudioData;
}

interface GeminiServerContent {
  modelTurn?: {
    parts?: GeminiServerContentPart[];
  };
  transcript?: {
    text?: string;
  };
  turnComplete?: boolean;
  generationComplete?: boolean;
}

interface GeminiFunctionCall {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
}

interface GeminiToolCallPayload {
  functionCalls?: GeminiFunctionCall[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInlineAudioData(value: unknown): value is InlineAudioData {
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

function isGeminiServerContentPart(value: unknown): value is GeminiServerContentPart {
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

function isGeminiServerContent(value: unknown): value is GeminiServerContent {
  if (!isRecord(value)) {
    return false;
  }
  const maybe = value as GeminiServerContent;
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

function isGeminiFunctionCall(value: unknown): value is GeminiFunctionCall {
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

function isGeminiToolCallPayload(value: unknown): value is GeminiToolCallPayload {
  if (!isRecord(value)) {
    return false;
  }
  const functionCalls = value.functionCalls;
  if (functionCalls === undefined) {
    return true;
  }
  return Array.isArray(functionCalls) && functionCalls.every(isGeminiFunctionCall);
}

function scrollToBottomOfImageContainer(): void {
  nextTick(() => {
    if (imageContainer.value) {
      imageContainer.value.scrollTop = imageContainer.value.scrollHeight;
    }
  });
}

function scrollCurrentResultToTop(): void {
  nextTick(() => {
    const mainContent = document.querySelector(
      ".flex-1.border.rounded.bg-gray-50.overflow-hidden",
    );
    if (mainContent) {
      const scrollableElement = mainContent.querySelector(
        "iframe, .w-full.h-full.overflow-auto, .w-full.h-full.flex",
      );
      if (scrollableElement) {
        if (scrollableElement.tagName === "IFRAME") {
          try {
            (scrollableElement as HTMLIFrameElement).contentWindow?.scrollTo(0, 0);
          } catch (e) {
            // Cross-origin iframe, can't scroll
          }
        } else {
          scrollableElement.scrollTop = 0;
        }
      }
    }
  });
}

function isTwitterUrl(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === "twitter.com" ||
      urlObj.hostname === "www.twitter.com" ||
      urlObj.hostname === "x.com" ||
      urlObj.hostname === "www.x.com"
    );
  } catch {
    return false;
  }
}

async function fetchTwitterEmbed(url: string): Promise<string | null> {
  try {
    const response = await fetch(
      `/api/twitter-embed?url=${encodeURIComponent(url)}`,
    );

    if (!response.ok) {
      throw new Error(`Twitter embed API error: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.html : null;
  } catch (error) {
    console.error("Failed to fetch Twitter embed:", error);
    return null;
  }
}

async function handleTwitterEmbed(url: string): Promise<void> {
  if (!isTwitterUrl(url) || url in twitterEmbedData.value) {
    return;
  }

  const embedHtml = await fetchTwitterEmbed(url);
  console.log("*** Twitter embed", url, embedHtml);
  twitterEmbedData.value[url] = embedHtml;
}

async function processToolCall(msg: any): Promise<void> {
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
  } catch (e) {
    console.error("Legacy code error:", e);
  }
}

async function messageHandler(message: GeminiLiveMessage): Promise<void> {
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

          const callMessage: GeminiToolCall = {
            type: "tool.call",
            call_id:
              functionCall.id && functionCall.id.length > 0
                ? functionCall.id
                : `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            name: functionCall.name,
            args: functionCall.args ?? {},
          };

          await processGeminiToolCall(callMessage);
        }
      }
    }

  } catch (error) {
    console.error("❌ Error handling Gemini Live message:", error);
  }
}

async function processGeminiToolCall(message: GeminiToolCall): Promise<void> {
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

    const context: PluginContext = {
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
  } catch (error) {
    console.error("❌ Failed to process Gemini tool call:", error);
    isGeneratingImage.value = false;

    // Send error response using adapter
    if (geminiLive.wsClient) {
      const errorResponse = ToolUtils.createStandardErrorResponse(callId, error as Error);
      await geminiLive.wsClient.sendMessage(errorResponse);
    }
  }
}

async function startChat(): Promise<void> {
  // Guard against double start
  if (chatActive.value || connecting.value) return;

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

    const setupMessage = createGeminiLiveSetupMessage(
      systemPrompt.value,
      geminiTools
    );

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
          } catch (error) {
            console.error("❌ Failed to stream audio chunk:", error);
          }
        }
      });
    }

    // Start local speech recognition for transcription
    startSpeechRecognition();

    chatActive.value = true;
    console.log("✅ Gemini Live session started successfully");

  } catch (err) {
    console.error("❌ Failed to start Gemini Live session:", err);
    stopChat();
    alert(`Failed to start voice chat: ${err instanceof Error ? err.message : 'Unknown error'}`);
  } finally {
    connecting.value = false;
  }
}

function startSpeechRecognition(): void {
  try {
    // Check if Web Speech API is available
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    
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

    recognitionInstance.onresult = (event: any) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (final) {
        localTranscript.value = final;
        messages.value.push(`You (voice): ${final}`);
        console.log("🎤 Final transcript:", final);
        // Clear interim after final result
        interimTranscript.value = "";
      } else {
        interimTranscript.value = interim;
      }
    };

    recognitionInstance.onerror = (event: any) => {
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
            } catch (e) {
              console.warn("⚠️ Could not restart speech recognition:", e);
            }
          }
        }, 100);
      }
    };

    recognitionInstance.start();
    console.log("🎤 Speech recognition initialized");

  } catch (error) {
    console.error("❌ Failed to initialize speech recognition:", error);
  }
}

function stopSpeechRecognition(): void {
  if (recognition.value) {
    try {
      recognition.value.stop();
      recognition.value = null;
      isRecognizing.value = false;
      localTranscript.value = "";
      interimTranscript.value = "";
      console.log("🎤 Speech recognition stopped");
    } catch (error) {
      console.error("❌ Failed to stop speech recognition:", error);
    }
  }
}

async function sendTextMessage(): Promise<void> {
  const text = userInput.value.trim();
  if (!text) return;

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
  } catch (error) {
    console.error("❌ Failed to send text message:", error);
  }
}

// Utility function for audio data conversion
function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Function to play audio from base64 data
async function playAudioFromBase64(base64Data: string): Promise<void> {
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
  } catch (error) {
    console.error("❌ Failed to play audio:", error);
  }
}

async function stopChat(): Promise<void> {
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
  } catch (error) {
    console.error("❌ Error stopping chat:", error);
    chatActive.value = false;
  }
}
</script>

<style scoped></style>
