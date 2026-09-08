import { useRef, useCallback, useState } from "react";

const TARGET_SAMPLE_RATE = 16000;

function downsampleToTargetRate(input: Float32Array, sourceSampleRate: number): Float32Array {
  if (sourceSampleRate === TARGET_SAMPLE_RATE) return input;

  const ratio = sourceSampleRate / TARGET_SAMPLE_RATE;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let outputIndex = 0; outputIndex < output.length; outputIndex++) {
    const start = Math.floor(outputIndex * ratio);
    const end = Math.min(Math.floor((outputIndex + 1) * ratio), input.length);
    let sum = 0;
    for (let inputIndex = start; inputIndex < end; inputIndex++) sum += input[inputIndex];
    output[outputIndex] = sum / Math.max(end - start, 1);
  }
  return output;
}

export function useAudioCapture(onAudioData: (data: ArrayBuffer) => void) {
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
        sampleRate: 16000,
      },
    });

    const audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(stream);
    // Use ScriptProcessorNode for simplicity (AudioWorklet is better but more complex)
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);
      const samples = downsampleToTargetRate(float32, audioContext.sampleRate);
      // Convert resampled mono audio to 16-bit PCM for Deepgram.
      const int16 = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      onAudioData(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    streamRef.current = stream;
    processorRef.current = processor;
    contextRef.current = audioContext;
    setIsCapturing(true);
  }, [onAudioData]);

  const stop = useCallback(() => {
    processorRef.current?.disconnect();
    contextRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    processorRef.current = null;
    contextRef.current = null;
    setIsCapturing(false);
  }, []);

  return { start, stop, isCapturing };
}
