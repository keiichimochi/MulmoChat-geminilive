import { ref, watch, nextTick } from "vue";
import { pluginTools, pluginExecute, pluginGeneratingMessage, pluginWaitingMessage, } from "./plugins/type";
import GoogleMap from "./components/GoogleMap.vue";
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
watch(systemPrompt, (val) => {
    localStorage.setItem(SYSTEM_PROMPT_KEY, val);
});
watch(selectedResult, (newResult) => {
    if (newResult?.url && isTwitterUrl(newResult.url)) {
        handleTwitterEmbed(newResult.url);
    }
});
const chatActive = ref(false);
const webrtc = {
    pc: null,
    dc: null,
    localStream: null,
    remoteStream: null,
};
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
        const context = {
            images: [],
        };
        if (selectedResult.value?.imageData) {
            context.images = [selectedResult.value.imageData];
        }
        const promise = pluginExecute(context, msg.name, args);
        const waitingMessage = pluginWaitingMessage(msg.name);
        if (waitingMessage) {
            webrtc.dc?.send(JSON.stringify({
                type: "response.create",
                response: {
                    instructions: waitingMessage,
                    // e.g., the model might say: "Your image is ready."
                },
            }));
        }
        const result = await promise;
        isGeneratingImage.value = false;
        pluginResults.value.push(result);
        selectedResult.value = result;
        scrollToBottomOfImageContainer();
        scrollCurrentResultToTop();
        const outputPayload = {
            status: result.message,
        };
        if (result.jsonData) {
            outputPayload.data = result.jsonData;
        }
        webrtc.dc?.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
                type: "function_call_output",
                call_id: msg.call_id,
                output: JSON.stringify(outputPayload),
            },
        }));
        if (result.instructions) {
            webrtc.dc?.send(JSON.stringify({
                type: "response.create",
                response: {
                    instructions: result.instructions,
                },
            }));
        }
    }
    catch (e) {
        console.error("Failed to parse function call arguments", e);
        // Let the model know that we failed to parse the function call arguments.
        webrtc.dc?.send(JSON.stringify({
            type: "conversation.item.create",
            item: {
                type: "function_call_output",
                call_id: msg.call_id,
                output: `Failed to parse function call arguments: ${e}`,
            },
        }));
        // We don't need to send "response.create" here.
    }
}
async function messageHandler(event) {
    const msg = JSON.parse(event.data);
    // console.log("Message", event.data.length, msg.type);
    if (msg.type === "error") {
        console.error("Error", msg.error);
    }
    if (msg.type === "response.text.delta") {
        currentText.value += msg.delta;
    }
    if (msg.type === "response.completed") {
        if (currentText.value.trim()) {
            messages.value.push(currentText.value);
        }
        currentText.value = "";
    }
    if (msg.type === "response.function_call_arguments.delta") {
        const id = msg.id || msg.call_id;
        pendingToolArgs[id] = (pendingToolArgs[id] || "") + msg.delta;
    }
    if (msg.type === "response.function_call_arguments.done") {
        await processToolCall(msg);
    }
}
async function startChat() {
    // Gard against double start
    if (chatActive.value || connecting.value)
        return;
    connecting.value = true;
    // Call the start API endpoint to get ephemeral key
    const config = {
        apiKey: undefined,
    };
    try {
        const response = await fetch("/api/start", {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
            },
        });
        if (!response.ok) {
            throw new Error(`API error: ${response.statusText}`);
        }
        startResponse.value = await response.json();
        config.apiKey = startResponse.value.ephemeralKey;
        googleMapKey.value = startResponse.value.googleMapKey;
        if (!config.apiKey) {
            throw new Error("No ephemeral key received from server");
        }
    }
    catch (err) {
        console.error("Failed to get ephemeral key:", err);
        alert("Failed to start session. Check console for details.");
        connecting.value = false;
        return;
    }
    try {
        webrtc.pc = new RTCPeerConnection();
        // Data channel for model events
        const dc = webrtc.pc.createDataChannel("oai-events");
        webrtc.dc = dc;
        dc.addEventListener("open", () => {
            dc.send(JSON.stringify({
                type: "session.update",
                session: {
                    type: "realtime",
                    model: "gpt-realtime",
                    instructions: systemPrompt.value,
                    audio: {
                        output: {
                            voice: "shimmer",
                        },
                    },
                    tools: pluginTools(startResponse.value),
                },
            }));
        });
        dc.addEventListener("message", messageHandler);
        dc.addEventListener("close", () => {
            webrtc.dc = null;
        });
        // Play remote audio
        webrtc.remoteStream = new MediaStream();
        webrtc.pc.ontrack = (event) => {
            webrtc.remoteStream.addTrack(event.track);
        };
        if (audioEl.value) {
            audioEl.value.srcObject = webrtc.remoteStream;
        }
        // Send microphone audio
        webrtc.localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
        });
        webrtc.localStream
            .getTracks()
            .forEach((track) => webrtc.pc.addTrack(track, webrtc.localStream));
        // Create and send offer SDP
        const offer = await webrtc.pc.createOffer();
        await webrtc.pc.setLocalDescription(offer);
        const response = await fetch("https://api.openai.com/v1/realtime/calls", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${config.apiKey}`,
                "Content-Type": "application/sdp",
            },
            body: offer.sdp,
        });
        const responseText = await response.text();
        await webrtc.pc.setRemoteDescription({ type: "answer", sdp: responseText });
        chatActive.value = true;
    }
    catch (err) {
        console.error(err);
        stopChat();
        alert("Failed to start voice chat. Check console for details.");
    }
    finally {
        connecting.value = false;
    }
}
function sendTextMessage() {
    const text = userInput.value.trim();
    if (!text)
        return;
    const dc = webrtc.dc;
    if (!chatActive.value || !dc || dc.readyState !== "open") {
        console.warn("Cannot send text message because the data channel is not ready.");
        return;
    }
    dc.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
            type: "message",
            role: "user",
            content: [
                {
                    type: "input_text",
                    text,
                },
            ],
        },
    }));
    dc.send(JSON.stringify({
        type: "response.create",
        response: {},
    }));
    messages.value.push(`You: ${text}`);
    userInput.value = "";
}
function stopChat() {
    if (webrtc.pc) {
        webrtc.pc.close();
        webrtc.pc = null;
    }
    if (webrtc.dc) {
        webrtc.dc.close();
        webrtc.dc = null;
    }
    if (webrtc.localStream) {
        webrtc.localStream.getTracks().forEach((track) => track.stop());
        webrtc.localStream = null;
    }
    if (webrtc.remoteStream) {
        webrtc.remoteStream.getTracks().forEach((track) => track.stop());
        webrtc.remoteStream = null;
    }
    if (audioEl.value) {
        audioEl.value.srcObject = null;
    }
    chatActive.value = false;
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
    ...{ class: "flex-1 flex flex-col" },
});
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
        pluginResults: pluginResults,
        isGeneratingImage: isGeneratingImage,
        generatingMessage: generatingMessage,
        showConfigPopup: showConfigPopup,
        selectedResult: selectedResult,
        userInput: userInput,
        twitterEmbedData: twitterEmbedData,
        googleMapKey: googleMapKey,
        chatActive: chatActive,
        scrollCurrentResultToTop: scrollCurrentResultToTop,
        isTwitterUrl: isTwitterUrl,
        startChat: startChat,
        sendTextMessage: sendTextMessage,
        stopChat: stopChat,
    }),
});
export default (await import('vue')).defineComponent({});
; /* PartiallyEnd: #4569/main.vue */
