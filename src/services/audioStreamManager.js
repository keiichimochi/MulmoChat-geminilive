import { ref } from 'vue';
/**
 * AudioStreamManager for Gemini Live
 *
 * Manages audio input/output streams with Gemini Live's specific requirements:
 * - 16kHz mono input (PCM)
 * - 24kHz mono output
 * - Low latency processing
 * - Audio quality monitoring
 */
export class AudioStreamManager {
    constructor(config) {
        Object.defineProperty(this, "audioContext", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "inputStream", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "inputNode", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "outputNode", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "gainNode", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        // Reactive state
        Object.defineProperty(this, "state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref('idle')
        });
        Object.defineProperty(this, "metrics", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref({
                inputLevel: 0,
                outputLevel: 0,
                latency: 0,
                bufferSize: 0,
            })
        });
        Object.defineProperty(this, "isStreaming", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref(false)
        });
        Object.defineProperty(this, "hasInputPermission", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ref(false)
        });
        // Audio configuration
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {
                inputSampleRate: 16000,
                outputSampleRate: 24000,
                channels: 1,
                bitDepth: 16,
            }
        });
        // Event handlers
        Object.defineProperty(this, "audioDataHandlers", {
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
        this.config = { ...this.config, ...config };
    }
    /**
     * Initialize audio system and request permissions
     */
    async setupInput() {
        try {
            this.setState('initializing');
            // Request microphone permission
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: this.config.inputSampleRate,
                    channelCount: this.config.channels,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });
            this.inputStream = stream;
            this.hasInputPermission.value = true;
            console.log('🎤 Audio input permission granted:', {
                sampleRate: this.config.inputSampleRate,
                channels: this.config.channels,
            });
            return stream;
        }
        catch (error) {
            console.error('❌ Failed to setup audio input:', error);
            this.setState('error');
            this.hasInputPermission.value = false;
            throw new Error('Microphone access denied or unavailable');
        }
    }
    /**
     * Setup audio output element
     */
    async setupOutput() {
        try {
            const audioElement = document.createElement('audio');
            audioElement.autoplay = true;
            // @ts-ignore - playsInline is not in standard HTMLAudioElement
            audioElement.playsInline = true;
            // Configure for low latency
            if ('mozAudioChannelType' in audioElement) {
                audioElement.mozAudioChannelType = 'content';
            }
            console.log('🔊 Audio output element created');
            return audioElement;
        }
        catch (error) {
            console.error('❌ Failed to setup audio output:', error);
            throw error;
        }
    }
    /**
     * Start audio streaming
     */
    async startStreaming() {
        if (!this.inputStream) {
            throw new Error('Audio input not initialized');
        }
        try {
            this.setState('initializing');
            // Create AudioContext with optimal settings
            this.audioContext = new AudioContext({
                sampleRate: this.config.inputSampleRate,
                latencyHint: 'interactive',
            });
            // Wait for context to be ready
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            // Create input processing node
            await this.setupInputProcessing();
            // Create output processing node
            await this.setupOutputProcessing();
            this.setState('streaming');
            this.isStreaming.value = true;
            console.log('🎵 Audio streaming started:', {
                contextSampleRate: this.audioContext.sampleRate,
                contextState: this.audioContext.state,
            });
        }
        catch (error) {
            console.error('❌ Failed to start audio streaming:', error);
            this.setState('error');
            throw error;
        }
    }
    /**
     * Stop audio streaming
     */
    async stopStreaming() {
        try {
            // Stop input processing
            if (this.inputNode) {
                this.inputNode.disconnect();
                this.inputNode = null;
            }
            // Stop output processing
            if (this.outputNode) {
                this.outputNode.disconnect();
                this.outputNode = null;
            }
            // Stop input stream
            if (this.inputStream) {
                this.inputStream.getTracks().forEach(track => track.stop());
                this.inputStream = null;
            }
            // Close audio context
            if (this.audioContext) {
                await this.audioContext.close();
                this.audioContext = null;
            }
            this.setState('idle');
            this.isStreaming.value = false;
            this.hasInputPermission.value = false;
            console.log('🔇 Audio streaming stopped');
        }
        catch (error) {
            console.error('❌ Failed to stop audio streaming:', error);
            throw error;
        }
    }
    /**
     * Configure audio settings
     */
    configureAudio(config) {
        this.config = { ...this.config, ...config };
        console.log('⚙️ Audio configuration updated:', this.config);
    }
    /**
     * Process incoming audio data for output
     */
    processAudioOutput(audioData) {
        if (!this.audioContext || !this.outputNode) {
            console.warn('⚠️ Audio output not ready, dropping audio data');
            return;
        }
        try {
            // Convert ArrayBuffer to Float32Array
            const float32Data = this.convertToFloat32Array(audioData);
            // Create audio buffer
            const audioBuffer = this.audioContext.createBuffer(this.config.channels, float32Data.length, this.config.outputSampleRate);
            // Copy data to buffer - ensure it's an ArrayBuffer
            const channelData = new Float32Array(audioData);
            audioBuffer.copyToChannel(channelData, 0);
            // Play audio buffer
            this.playAudioBuffer(audioBuffer);
            // Update metrics
            this.updateOutputMetrics(float32Data);
        }
        catch (error) {
            console.error('❌ Failed to process audio output:', error);
        }
    }
    /**
     * Event handler registration
     */
    onAudioData(handler) {
        this.audioDataHandlers.push(handler);
        return () => {
            const index = this.audioDataHandlers.indexOf(handler);
            if (index > -1) {
                this.audioDataHandlers.splice(index, 1);
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
     * Get current audio configuration
     */
    getConfig() {
        return { ...this.config };
    }
    /**
     * Get audio context info for debugging
     */
    getAudioContextInfo() {
        if (!this.audioContext)
            return null;
        return {
            sampleRate: this.audioContext.sampleRate,
            state: this.audioContext.state,
            currentTime: this.audioContext.currentTime,
            baseLatency: this.audioContext.baseLatency,
        };
    }
    /**
     * Private methods
     */
    async setupInputProcessing() {
        if (!this.audioContext || !this.inputStream)
            return;
        try {
            // Create input source
            const inputSource = this.audioContext.createMediaStreamSource(this.inputStream);
            // Create gain node for volume control
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0;
            // For now, use ScriptProcessorNode (deprecated but widely supported)
            // In production, should migrate to AudioWorklet
            const bufferSize = 4096;
            const processor = this.audioContext.createScriptProcessor(bufferSize, this.config.channels, this.config.channels);
            processor.onaudioprocess = (event) => {
                const inputBuffer = event.inputBuffer;
                const inputData = inputBuffer.getChannelData(0);
                // Convert to the format expected by Gemini Live (16kHz, PCM)
                const processedData = this.resampleAndConvert(inputData);
                // Update input metrics
                this.updateInputMetrics(inputData);
                // Notify audio data handlers
                this.audioDataHandlers.forEach(handler => {
                    try {
                        handler(processedData);
                    }
                    catch (error) {
                        console.error('❌ Error in audio data handler:', error);
                    }
                });
            };
            // Connect the audio graph
            inputSource.connect(this.gainNode);
            this.gainNode.connect(processor);
            processor.connect(this.audioContext.destination);
            console.log('🎤 Input processing setup complete');
        }
        catch (error) {
            console.error('❌ Failed to setup input processing:', error);
            throw error;
        }
    }
    async setupOutputProcessing() {
        if (!this.audioContext)
            return;
        // Output processing will be handled by processAudioOutput method
        console.log('🔊 Output processing setup complete');
    }
    resampleAndConvert(inputData) {
        // For now, return the data as-is
        // In production, implement proper resampling if needed
        return inputData;
    }
    convertToFloat32Array(audioData) {
        // Convert ArrayBuffer to Float32Array
        // This assumes the input is already in the correct format
        return new Float32Array(audioData);
    }
    playAudioBuffer(audioBuffer) {
        if (!this.audioContext)
            return;
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        source.start();
    }
    updateInputMetrics(audioData) {
        // Calculate RMS level
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        this.metrics.value.inputLevel = Math.min(rms * 10, 1.0); // Scale and clamp
        this.metrics.value.bufferSize = audioData.length;
    }
    updateOutputMetrics(audioData) {
        // Calculate RMS level for output
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            sum += audioData[i] * audioData[i];
        }
        const rms = Math.sqrt(sum / audioData.length);
        this.metrics.value.outputLevel = Math.min(rms * 10, 1.0); // Scale and clamp
    }
    setState(state) {
        this.state.value = state;
    }
    notifyError(error) {
        this.setState('error');
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
 * Create AudioStreamManager with default configuration
 */
export function createAudioStreamManager(config) {
    return new AudioStreamManager(config);
}
/**
 * Check browser audio API support
 */
export function checkAudioSupport() {
    const hasWebAudio = 'AudioContext' in window || 'webkitAudioContext' in window;
    const hasMediaDevices = 'mediaDevices' in navigator;
    const hasGetUserMedia = hasMediaDevices && 'getUserMedia' in navigator.mediaDevices;
    let supportedConstraints = null;
    if (hasMediaDevices) {
        try {
            supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
        }
        catch (error) {
            console.warn('⚠️ Could not get supported constraints:', error);
        }
    }
    return {
        hasWebAudio,
        hasMediaDevices,
        hasGetUserMedia,
        supportedConstraints,
    };
}
/**
 * Default audio configuration for Gemini Live
 */
export const DEFAULT_AUDIO_CONFIG = {
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    channels: 1,
    bitDepth: 16,
};
