<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { useChat, useOptions } from '@n8n/chat/composables';
import { chatEventBus } from '@n8n/chat/event-buses';

const chatStore = useChat();
const { options } = useOptions();

// Estado de grabación y envío
const isListening = ref(false);
const isSending = ref(false);
const transcript = ref('');
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;
let usedMimeType: string | undefined;
// Waveform
const waveCanvas = ref<HTMLCanvasElement | null>(null);
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let rafId: number | null = null;

async function onClick() {
	if (!isListening.value) {
		// Empezar a grabar
		await startRecording();
	} else {
		// Detener y enviar
		await stopRecordingAndSend();
	}
}

async function startRecording() {
	transcript.value = '';
	try {
		mediaStream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				sampleRate: 48000,
				sampleSize: 16,
				echoCancellation: false,
				autoGainControl: false,
				noiseSuppression: false,
			},
		});

		const mimeType = pickSupportedMimeType([
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/ogg;codecs=opus',
			'audio/ogg',
		]);
		usedMimeType = mimeType;
		mediaRecorder = new MediaRecorder(mediaStream, {
			...(mimeType ? { mimeType } : {}),
			audioBitsPerSecond: 128000,
		});
		audioChunks = [];
		mediaRecorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) audioChunks.push(e.data);
		};
		mediaRecorder.onstop = async () => {
			const recordedType = usedMimeType || mediaRecorder?.mimeType || 'audio/webm';
			const rawBlob = new Blob(audioChunks, { type: recordedType });
			// Try to transcode to 16kHz mono WAV for better STT quality
			const wavBlob = await transcodeToWav(rawBlob, 16000).catch(() => null);
			const audioBlob = wavBlob || rawBlob;
			audioChunks = [];
			teardownWaveform();
			await sendAudio(audioBlob);
			// detener pistas
			if (mediaStream) {
				mediaStream.getTracks().forEach((t) => t.stop());
				mediaStream = null;
			}
		};
		mediaRecorder.start();
		isListening.value = true;
		setupWaveform(mediaStream);
	} catch (e) {
		console.error('Mic permission or recording error', e);
		isListening.value = false;
		if (mediaStream) {
			mediaStream.getTracks().forEach((t) => t.stop());
			mediaStream = null;
		}
	}
}

async function stopRecordingAndSend() {
	if (!mediaRecorder) return;
	isListening.value = false;
	try {
		mediaRecorder.stop();
	} catch {
		// noop
	}
}

async function sendAudio(audioBlob: Blob) {
	if (isSending.value) return;
	isSending.value = true;
	try {
		// 1) Llamada 1: enviar audio -> obtener transcripción
		const form = new FormData();
		form.append('action', 'audio');
		form.append(options.chatSessionKey as string, chatStore.currentSessionId.value || '');
		const filename = audioBlob.type === 'audio/wav' ? 'audio.wav' : 'audio.webm';
		form.append('audio', audioBlob, filename);
		if (options.metadata) form.append('metadata', JSON.stringify(options.metadata));

		const res1 = await fetch(options.webhookUrl, {
			method: 'POST',
			headers: { ...(options.webhookConfig?.headers || {}) },
			body: form,
		});
		if (!res1.ok) throw new Error(`Webhook (audio) failed: ${res1.status}`);
		const data1 = await res1.json(); // { text: transcript }
		const userText = (data1?.text || '').toString();
		if (userText) {
			chatStore.messages.value.push({ id: crypto.randomUUID(), text: userText, sender: 'user' });
			transcript.value = userText;
			chatEventBus.emit('scrollToBottom');
		}

		// 2) Llamada 2: responseType=messageFromAudio -> { text, audio }
		const res2 = await fetch(options.webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(options.webhookConfig?.headers || {}),
			},
			body: JSON.stringify({
				action: 'messageFromAudio',
				[options.chatSessionKey as string]: chatStore.currentSessionId.value || '',
				text: userText,
				...(options.metadata ? { metadata: options.metadata } : {}),
			}),
		});
		if (!res2.ok) throw new Error(`Webhook (messageFromAudio) failed: ${res2.status}`);
		const data2 = await res2.json(); // { text?: string, audio?: string }
		const botText = (data2?.text || '').toString();
		if (botText) {
			chatStore.messages.value.push({ id: crypto.randomUUID(), text: botText, sender: 'bot' });
			chatEventBus.emit('scrollToBottom');
		}

		if (data2?.audio) {
			try {
				const audio = new Audio(data2.audio);
				void audio.play();
			} catch {}
		}
	} catch (e) {
		// opcional: mostrar error
		console.error(e);
	} finally {
		isSending.value = false;
	}
}

onUnmounted(() => {
	try {
		if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
	} catch {}
	if (mediaStream) {
		mediaStream.getTracks().forEach((t) => t.stop());
		mediaStream = null;
	}
	teardownWaveform();
});

function setupWaveform(stream: MediaStream) {
	try {
		audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
		const source = audioContext.createMediaStreamSource(stream);
		analyser = audioContext.createAnalyser();
		analyser.fftSize = 1024;
		source.connect(analyser);
		drawWaveform();
	} catch (e) {
		// waveform opcional
		console.warn('Waveform disabled:', e);
	}
}

function drawWaveform() {
	if (!analyser || !waveCanvas.value) return;
	const canvas = waveCanvas.value;
	const ctx = canvas.getContext('2d');
	if (!ctx) return;

	// ajustar tamaño al contenedor
	const width = canvas.clientWidth || 300;
	const height = canvas.clientHeight || 28;
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}

	const data = new Uint8Array(analyser.fftSize);
	analyser.getByteTimeDomainData(data);

	ctx.clearRect(0, 0, width, height);
	// fondo sutil
	ctx.fillStyle = 'rgba(99,102,241,0.08)';
	ctx.fillRect(0, 0, width, height);

	ctx.lineWidth = 2;
	ctx.strokeStyle = 'var(--chat--color-primary, #6366f1)';
	ctx.beginPath();
	const sliceWidth = width / data.length;
	let x = 0;
	for (let i = 0; i < data.length; i++) {
		const v = data[i] / 128.0;
		const y = (v * height) / 2;
		if (i === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
		x += sliceWidth;
	}
	ctx.lineTo(width, height / 2);
	ctx.stroke();

	rafId = requestAnimationFrame(drawWaveform);
}

function teardownWaveform() {
	if (rafId) {
		cancelAnimationFrame(rafId);
		rafId = null;
	}
	if (audioContext) {
		try {
			audioContext.close();
		} catch {}
		audioContext = null;
	}
	analyser = null;
}

// Pick best supported codec/container
function pickSupportedMimeType(candidates: string[]): string | undefined {
	if (!('MediaRecorder' in window)) return undefined;
	for (const t of candidates) {
		try {
			if ((window as any).MediaRecorder.isTypeSupported?.(t)) return t;
		} catch {}
	}
	return undefined;
}

// Transcode Blob (webm/ogg/opus) to 16kHz mono WAV using WebAudio
async function transcodeToWav(input: Blob, targetSampleRate = 16000): Promise<Blob> {
	// Some browsers can't decode webm via decodeAudioData; try via HTMLAudioElement/MediaElementAudioSourceNode fallback if needed.
	const arrayBuf = await input.arrayBuffer();
	const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
	let decoded: AudioBuffer;
	try {
		// Modern browsers: Promise-based decode
		decoded = await decodeCtx.decodeAudioData(arrayBuf.slice(0));
	} catch {
		// Fallback to callback signature
		decoded = await new Promise<AudioBuffer>((resolve, reject) => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(decodeCtx as any).decodeAudioData(arrayBuf, resolve, reject);
		});
	} finally {
		try {
			decodeCtx.close();
		} catch {}
	}

	// Downmix to mono if needed
	let monoBuffer: AudioBuffer;
	if (decoded.numberOfChannels === 1) monoBuffer = decoded;
	else {
		const len = decoded.length;
		const sampleRate = decoded.sampleRate;
		monoBuffer = new AudioBuffer({ length: len, sampleRate, numberOfChannels: 1 });
		const out = monoBuffer.getChannelData(0);
		const chans = decoded.numberOfChannels;
		const inputs = new Array(chans).fill(0).map((_, i) => decoded.getChannelData(i));
		for (let i = 0; i < len; i++) {
			let sum = 0;
			for (let c = 0; c < chans; c++) sum += inputs[c][i];
			out[i] = sum / chans;
		}
	}

	// High-quality resample using OfflineAudioContext
	const length = Math.ceil(monoBuffer.duration * targetSampleRate);
	const offline = new OfflineAudioContext(1, length, targetSampleRate);
	const src = offline.createBufferSource();
	src.buffer = monoBuffer;
	src.connect(offline.destination);
	src.start(0);
	const rendered = await offline.startRendering();
	const samples = rendered.getChannelData(0);
	const wav = encodeWav(samples, targetSampleRate);
	return new Blob([wav], { type: 'audio/wav' });
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
	const bytesPerSample = 2; // 16-bit PCM
	const blockAlign = 1 * bytesPerSample;
	const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
	const view = new DataView(buffer);

	// Write WAV header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + samples.length * bytesPerSample, true);
	writeString(view, 8, 'WAVE');
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // PCM chunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, 1, true); // mono
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true); // byte rate
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, 8 * bytesPerSample, true); // bits per sample
	writeString(view, 36, 'data');
	view.setUint32(40, samples.length * bytesPerSample, true);

	// PCM samples
	floatTo16BitPCM(view, 44, samples);
	return buffer;
}

function writeString(view: DataView, offset: number, str: string) {
	for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function floatTo16BitPCM(view: DataView, offset: number, input: Float32Array) {
	let pos = offset;
	for (let i = 0; i < input.length; i++, pos += 2) {
		let s = Math.max(-1, Math.min(1, input[i]));
		view.setInt16(pos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
	}
}
</script>

<template>
	<div class="voice-footer">
		<button class="mic-button" @click="onClick" :aria-pressed="isListening" :disabled="isSending">
			<span class="dot" :class="{ active: isListening }" />
			<span class="icon">🎤</span>
		</button>

		<div class="waveform" v-show="isListening">
			<canvas ref="waveCanvas"></canvas>
		</div>

		<div class="transcript" v-if="transcript">
			<span class="label">Dijiste:</span>
			<span class="text">{{ transcript }}</span>
		</div>
	</div>
</template>

<style scoped>
.voice-footer {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0.75rem;
}
.waveform {
	flex: 1;
	height: 28px;
	min-width: 120px;
}
.waveform canvas {
	width: 100%;
	height: 100%;
	display: block;
	border-radius: 8px;
}
.mic-button {
	position: relative;
	width: 44px;
	height: 44px;
	border-radius: 999px;
	border: 1px solid var(--chat--border-color);
	background: var(--chat--input--background, #fff);
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	outline: none;
}
.icon {
	position: relative;
	z-index: 2;
	font-size: 18px;
}
.dot {
	position: absolute;
	inset: 0;
	border-radius: 999px;
	background: radial-gradient(circle at 50% 50%, rgba(34, 211, 238, 0.25), rgba(99, 102, 241, 0.1));
	opacity: 0;
	transition: opacity 0.2s ease;
}
.dot.active {
	opacity: 1;
}
.transcript {
	color: var(--chat--text-color, #111);
	font-size: 0.9rem;
}
.transcript .label {
	color: var(--muted);
	margin-right: 0.35rem;
}
.transcript .text {
	font-weight: 500;
}
</style>
