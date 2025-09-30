import { ref, type Ref } from 'vue';

/**
 * Audio configuration for Gemini Live
 */
export interface AudioConfig {
  inputSampleRate: 16000; // Gemini Live requirement
  outputSampleRate: 24000; // Gemini Live output
  channels: 1; // Mono
  bitDepth: 16;
}

/**
 * Audio stream state
 */
export type AudioStreamState = 'idle' | 'initializing' | 'streaming' | 'error';

/**
 * Audio quality metrics
 */
export interface AudioMetrics {
  inputLevel: number; // 0-1
  outputLevel: number; // 0-1
  latency: number; // ms
  bufferSize: number; // samples
}

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
  private audioContext: AudioContext | null = null;
  private inputStream: MediaStream | null = null;
  private inputNode: AudioWorkletNode | null = null;
  private outputNode: AudioWorkletNode | null = null;
  private gainNode: GainNode | null = null;

  // Reactive state
  public readonly state: Ref<AudioStreamState> = ref('idle');
  public readonly metrics: Ref<AudioMetrics> = ref({
    inputLevel: 0,
    outputLevel: 0,
    latency: 0,
    bufferSize: 0,
  });
  public readonly isStreaming: Ref<boolean> = ref(false);
  public readonly hasInputPermission: Ref<boolean> = ref(false);

  // Audio configuration
  private config: AudioConfig = {
    inputSampleRate: 16000,
    outputSampleRate: 24000,
    channels: 1,
    bitDepth: 16,
  };

  // VAD (Voice Activity Detection) configuration
  private readonly SILENCE_THRESHOLD = 0.01; // 無音と判断する閾値（調整可能）
  private readonly VAD_ENABLED = true; // VAD機能の有効/無効
  private readonly VAD_DEBUG = false; // VADデバッグログの有効/無効

  // Event handlers
  private audioDataHandlers: Array<(audioData: Float32Array) => void> = [];
  private errorHandlers: Array<(error: Error) => void> = [];

  constructor(config?: Partial<AudioConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Initialize audio system and request permissions
   */
  async setupInput(): Promise<MediaStream> {
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
    } catch (error) {
      console.error('❌ Failed to setup audio input:', error);
      this.setState('error');
      this.hasInputPermission.value = false;
      throw new Error('Microphone access denied or unavailable');
    }
  }

  /**
   * Setup audio output element
   */
  async setupOutput(): Promise<HTMLAudioElement> {
    try {
      const audioElement = document.createElement('audio');
      audioElement.autoplay = true;
      // @ts-ignore - playsInline is not in standard HTMLAudioElement
      audioElement.playsInline = true;

      // Configure for low latency
      if ('mozAudioChannelType' in audioElement) {
        (audioElement as any).mozAudioChannelType = 'content';
      }

      console.log('🔊 Audio output element created');
      return audioElement;
    } catch (error) {
      console.error('❌ Failed to setup audio output:', error);
      throw error;
    }
  }

  /**
   * Start audio streaming
   */
  async startStreaming(): Promise<void> {
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

    } catch (error) {
      console.error('❌ Failed to start audio streaming:', error);
      this.setState('error');
      throw error;
    }
  }

  /**
   * Stop audio streaming
   */
  async stopStreaming(): Promise<void> {
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
    } catch (error) {
      console.error('❌ Failed to stop audio streaming:', error);
      throw error;
    }
  }

  /**
   * Configure audio settings
   */
  configureAudio(config: Partial<AudioConfig>): void {
    this.config = { ...this.config, ...config };
    console.log('⚙️ Audio configuration updated:', this.config);
  }

  /**
   * Process incoming audio data for output
   */
  processAudioOutput(audioData: ArrayBuffer): void {
    // Create AudioContext if not initialized
    if (!this.audioContext) {
      console.log('🔊 Initializing AudioContext for output');
      this.audioContext = new AudioContext({
        sampleRate: this.config.outputSampleRate,
        latencyHint: 'interactive',
      });
    }

    // Debug: Log AudioContext state
    console.log(`[DEBUG] 🎧 AudioContext state: ${this.audioContext.state}, 再生開始...`);

    // Resume AudioContext if suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      console.warn('⚠️ AudioContext is suspended, attempting to resume...');
      this.audioContext.resume().then(() => {
        console.log('✅ AudioContext resumed successfully');
      }).catch((error) => {
        console.error('❌ Failed to resume AudioContext:', error);
      });
    }

    try {
      // Convert 16-bit PCM ArrayBuffer to Float32Array
      const pcmData = new Int16Array(audioData);
      const float32Data = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        float32Data[i] = pcmData[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Debug: Log conversion result
      if (float32Data.length > 0) {
        console.log(`[DEBUG] 🎼 フォーマット変換成功: データ長 ${float32Data.length}, 最初の値 ${float32Data[0]}`);
      } else {
        console.warn('[DEBUG] ⚠️ フォーマット変換後のデータが空です');
      }

      // Create audio buffer
      const audioBuffer = this.audioContext.createBuffer(
        this.config.channels,
        float32Data.length,
        this.config.outputSampleRate
      );

      // Copy data to buffer
      audioBuffer.copyToChannel(float32Data, 0);

      // Play audio buffer
      this.playAudioBuffer(audioBuffer);

      // Update metrics
      this.updateOutputMetrics(float32Data);

      console.log('🔊 Audio output processed and playing', {
        samples: float32Data.length,
        duration: audioBuffer.duration.toFixed(2) + 's',
        sampleRate: this.config.outputSampleRate
      });

    } catch (error) {
      console.error('❌ Failed to process audio output:', error);
    }
  }

  /**
   * Play PCM audio from base64 encoded data
   * @param base64Data Base64 encoded PCM audio data (16-bit signed integer)
   * @param sampleRate Sample rate of the audio (default: 24000 for Gemini Live)
   */
  async playPCMAudio(base64Data: string, sampleRate: number = 24000): Promise<void> {
    try {
      // Convert base64 to ArrayBuffer
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Convert 16-bit PCM to Float32Array
      const pcmData = new Int16Array(bytes.buffer);
      const floatData = new Float32Array(pcmData.length);
      for (let i = 0; i < pcmData.length; i++) {
        floatData[i] = pcmData[i] / 32768.0; // Normalize to -1.0 to 1.0
      }

      // Create AudioContext if not initialized
      if (!this.audioContext) {
        this.audioContext = new AudioContext({
          sampleRate: sampleRate,
          latencyHint: 'interactive'
        });
      }

      // Resume context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      // Create AudioBuffer
      const audioBuffer = this.audioContext.createBuffer(
        this.config.channels,
        floatData.length,
        sampleRate
      );
      audioBuffer.copyToChannel(floatData, 0);

      // Create buffer source and play
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      source.start(0);

      // Update metrics
      this.updateOutputMetrics(floatData);

      console.log('🔊 PCM audio playback started', {
        sampleRate,
        duration: audioBuffer.duration.toFixed(2) + 's',
        samples: floatData.length
      });

      return new Promise<void>((resolve) => {
        source.onended = () => {
          source.disconnect();
          resolve();
        };
      });
    } catch (error) {
      console.error('❌ Failed to play PCM audio:', error);
      throw error;
    }
  }

  /**
   * Event handler registration
   */
  onAudioData(handler: (audioData: Float32Array) => void): () => void {
    this.audioDataHandlers.push(handler);
    return () => {
      const index = this.audioDataHandlers.indexOf(handler);
      if (index > -1) {
        this.audioDataHandlers.splice(index, 1);
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
   * Get current audio configuration
   */
  getConfig(): AudioConfig {
    return { ...this.config };
  }

  /**
   * Get audio context info for debugging
   */
  getAudioContextInfo(): {
    sampleRate: number | null;
    state: string | null;
    currentTime: number | null;
    baseLatency: number | null;
  } | null {
    if (!this.audioContext) return null;

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

  private async setupInputProcessing(): Promise<void> {
    if (!this.audioContext || !this.inputStream) return;

    try {
      // Create input source
      const inputSource = this.audioContext.createMediaStreamSource(this.inputStream);

      // Create gain node for volume control
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = 1.0;

      // For now, use ScriptProcessorNode (deprecated but widely supported)
      // In production, should migrate to AudioWorklet
      const bufferSize = 4096;
      const processor = this.audioContext.createScriptProcessor(
        bufferSize,
        this.config.channels,
        this.config.channels
      );

      processor.onaudioprocess = (event) => {
        const inputBuffer = event.inputBuffer;
        const inputData = inputBuffer.getChannelData(0);

        // VAD: Calculate audio level (RMS)
        const level = this.calculateAudioLevel(inputData);

        // Update input metrics
        this.updateInputMetrics(inputData);

        // VAD: Skip sending if audio level is below threshold
        if (this.VAD_ENABLED && level < this.SILENCE_THRESHOLD) {
          // Silence detected - do not send to API
          if (this.VAD_DEBUG) {
            console.log(`🔇 VAD: Silence detected (level: ${level.toFixed(4)} < threshold: ${this.SILENCE_THRESHOLD})`);
          }
          return;
        }

        // VAD Debug: Log active speech detection
        if (this.VAD_DEBUG && this.VAD_ENABLED) {
          console.log(`🎤 VAD: Speech detected (level: ${level.toFixed(4)} >= threshold: ${this.SILENCE_THRESHOLD})`);
        }

        // Convert to the format expected by Gemini Live (16kHz, PCM)
        const processedData = this.resampleAndConvert(inputData);

        // Notify audio data handlers (send to Gemini Live API)
        this.audioDataHandlers.forEach(handler => {
          try {
            handler(processedData);
          } catch (error) {
            console.error('❌ Error in audio data handler:', error);
          }
        });
      };

      // Connect the audio graph
      inputSource.connect(this.gainNode);
      this.gainNode.connect(processor);
      processor.connect(this.audioContext.destination);

      console.log('🎤 Input processing setup complete', {
        VAD_enabled: this.VAD_ENABLED,
        silence_threshold: this.SILENCE_THRESHOLD,
        VAD_debug: this.VAD_DEBUG
      });

    } catch (error) {
      console.error('❌ Failed to setup input processing:', error);
      throw error;
    }
  }

  private async setupOutputProcessing(): Promise<void> {
    if (!this.audioContext) return;

    // Output processing will be handled by processAudioOutput method
    console.log('🔊 Output processing setup complete');
  }

  private resampleAndConvert(inputData: Float32Array): Float32Array {
    // For now, return the data as-is
    // In production, implement proper resampling if needed
    return inputData;
  }

  private convertToFloat32Array(audioData: ArrayBuffer): Float32Array {
    // 16ビットの符号付き整数としてデータを解釈
    const pcmData = new Int16Array(audioData);

    // Web Audio APIが要求する-1.0から1.0の間の浮動小数点数に変換
    const float32Data = new Float32Array(pcmData.length);
    for (let i = 0; i < pcmData.length; i++) {
      // 16ビット整数の最大値32767で割って正規化する
      float32Data[i] = pcmData[i] / 32767.0;
    }

    return float32Data;
  }

  /**
   * 音声データの音量レベル（RMS）を計算します。
   * @param data 音声データ（Float32Array）
   * @returns 音量レベル（0.0〜1.0）
   */
  private calculateAudioLevel(data: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);
    return rms;
  }

  private playAudioBuffer(audioBuffer: AudioBuffer): void {
    if (!this.audioContext) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.audioContext.destination);
    source.start();
  }

  private updateInputMetrics(audioData: Float32Array): void {
    // Calculate RMS level
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    this.metrics.value.inputLevel = Math.min(rms * 10, 1.0); // Scale and clamp
    this.metrics.value.bufferSize = audioData.length;
  }

  private updateOutputMetrics(audioData: Float32Array): void {
    // Calculate RMS level for output
    let sum = 0;
    for (let i = 0; i < audioData.length; i++) {
      sum += audioData[i] * audioData[i];
    }
    const rms = Math.sqrt(sum / audioData.length);

    this.metrics.value.outputLevel = Math.min(rms * 10, 1.0); // Scale and clamp
  }

  private setState(state: AudioStreamState): void {
    this.state.value = state;
  }

  private notifyError(error: Error): void {
    this.setState('error');
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
 * Create AudioStreamManager with default configuration
 */
export function createAudioStreamManager(config?: Partial<AudioConfig>): AudioStreamManager {
  return new AudioStreamManager(config);
}

/**
 * Check browser audio API support
 */
export function checkAudioSupport(): {
  hasWebAudio: boolean;
  hasMediaDevices: boolean;
  hasGetUserMedia: boolean;
  supportedConstraints: MediaTrackSupportedConstraints | null;
} {
  const hasWebAudio = 'AudioContext' in window || 'webkitAudioContext' in window;
  const hasMediaDevices = 'mediaDevices' in navigator;
  const hasGetUserMedia = hasMediaDevices && 'getUserMedia' in navigator.mediaDevices;

  let supportedConstraints = null;
  if (hasMediaDevices) {
    try {
      supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    } catch (error) {
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
export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  inputSampleRate: 16000,
  outputSampleRate: 24000,
  channels: 1,
  bitDepth: 16,
};