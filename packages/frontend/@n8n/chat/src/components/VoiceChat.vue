<script setup lang="ts">
import { ref, onUnmounted } from 'vue';
import { useChat, useOptions } from '@n8n/chat/composables';
import { chatEventBus } from '@n8n/chat/event-buses';
import IconMic from 'virtual:icons/mdi/microphone';

const chatStore = useChat();
const { options } = useOptions();

// Estado de grabación y envío
const isListening = ref(false);
const isSending = ref(false);
const isSpeaking = ref(false);
const speakLevel = ref(0);
const transcript = ref('');
const userTyping = ref(false);
let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let mediaStream: MediaStream | null = null;
// Waveform
const waveCanvas = ref<HTMLCanvasElement | null>(null);
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let rafId: number | null = null;
// Playback analyser for speaking animation
let speakCtx: AudioContext | null = null;
let speakAnalyser: AnalyserNode | null = null;
let speakRafId: number | null = null;

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
		mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
		mediaRecorder = new MediaRecorder(mediaStream);
		audioChunks = [];
		mediaRecorder.ondataavailable = (e) => {
			if (e.data && e.data.size > 0) audioChunks.push(e.data);
		};
		mediaRecorder.onstop = async () => {
			const blob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
			audioChunks = [];
			teardownWaveform();
			await sendAudio(blob);
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
	userTyping.value = true;
	chatEventBus.emit('voice:user-typing:start');
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
			userTyping.value = false;
			chatEventBus.emit('voice:user-typing:stop');
			chatStore.messages.value.push({ id: crypto.randomUUID(), text: userText, sender: 'user' });
			transcript.value = userText;
			chatEventBus.emit('scrollToBottom');
		}

		// Ahora empieza el waiting para la respuesta del bot
		chatStore.waitingForResponse.value = true;

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
				chatInput: userText,
				...(options.metadata ? { metadata: options.metadata } : {}),
			}),
		});
		if (!res2.ok) throw new Error(`Webhook (messageFromAudio) failed: ${res2.status}`);
		const data2 = await res2.json();
		const botText = (data2?.output || '').toString();
		if (botText) {
			chatStore.messages.value.push({ id: crypto.randomUUID(), text: botText, sender: 'bot' });
			chatEventBus.emit('scrollToBottom');
		}

		// Intentar reproducir audio con distintas formas posibles devueltas por el webhook
		await playAudioFromResponse(data2).catch((err) => {
			console.warn('No se pudo reproducir el audio de la respuesta:', err);
		});
	} catch (e) {
		// opcional: mostrar error
		console.error(e);
	} finally {
		userTyping.value = false;
		chatEventBus.emit('voice:user-typing:stop');
		chatStore.waitingForResponse.value = false;
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
	// Obtener el color de la variable CSS definida en el canvas
	const computedStyle = getComputedStyle(canvas);
	const strokeColor = computedStyle.getPropertyValue('--waveform-stroke-color').trim() || '#6366f1';
	ctx.strokeStyle = strokeColor;
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

// ===== Audio helpers (respuesta del bot) =====
async function playAudioFromResponse(payload: any) {
	// Simplificado: siempre esperamos base64 en payload.audio; si es data URL, se usa tal cual
	const audioStr: string | undefined =
		typeof payload?.audio === 'string' ? payload.audio : undefined;
	if (!audioStr) return Promise.reject(new Error('No audio base64 in payload.audio'));
	const audio = new Audio(audioStr);
	wireSpeakingLifecycle(audio);
	return audio.play();
}

function wireSpeakingLifecycle(audio: HTMLAudioElement) {
	const onPlaying = () => startSpeaking(audio);
	const onEnd = () => {
		stopSpeaking();
		audio.removeEventListener('playing', onPlaying);
		audio.removeEventListener('ended', onEnd);
		audio.removeEventListener('pause', onEnd);
		audio.removeEventListener('error', onEnd);
	};
	audio.addEventListener('playing', onPlaying);
	audio.addEventListener('ended', onEnd);
	audio.addEventListener('pause', onEnd);
	audio.addEventListener('error', onEnd);
}

function startSpeaking(audioEl: HTMLAudioElement) {
	isSpeaking.value = true;
	// Setup analyser to drive animation level
	try {
		speakCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
		const src = speakCtx.createMediaElementSource(audioEl);
		speakAnalyser = speakCtx.createAnalyser();
		speakAnalyser.fftSize = 256;
		src.connect(speakAnalyser);
		// CORREGIDO: Conectar directamente al destino para que se escuche
		speakAnalyser.connect(speakCtx.destination);
		const data = new Uint8Array(speakAnalyser.frequencyBinCount);
		// notify start
		chatEventBus.emit('speaking:start');
		const loop = () => {
			if (!speakAnalyser) return;
			speakAnalyser.getByteFrequencyData(data);
			// Average magnitude normalized 0..1
			let sum = 0;
			for (let i = 0; i < data.length; i++) sum += data[i];
			const avg = sum / (data.length * 255);
			speakLevel.value = Math.max(0.05, Math.min(1, avg * 1.5));
			chatEventBus.emit('speaking:level', speakLevel.value);
			speakRafId = requestAnimationFrame(loop);
		};
		loop();
	} catch (e) {
		// Fallback: simple pulsing
		let t = 0;
		chatEventBus.emit('speaking:start');
		const loop = () => {
			speakLevel.value = 0.3 + 0.2 * Math.sin(t);
			t += 0.15;
			chatEventBus.emit('speaking:level', speakLevel.value);
			speakRafId = requestAnimationFrame(loop);
		};
		loop();
	}
}

function stopSpeaking() {
	isSpeaking.value = false;
	speakLevel.value = 0;
	if (speakRafId) {
		cancelAnimationFrame(speakRafId);
		speakRafId = null;
	}
	if (speakCtx) {
		try {
			speakCtx.close();
		} catch {}
		speakCtx = null;
	}
	speakAnalyser = null;
	chatEventBus.emit('speaking:stop');
}
</script>

<template>
	<div class="voice-footer">
		<button
			class="mic-button"
			@click="onClick"
			:aria-pressed="isListening"
			:disabled="isSending"
			:style="{ '--speak-level': speakLevel.toFixed(2) }"
		>
			<span class="dot" :class="{ active: isListening }" />
			<IconMic class="icon" />
		</button>

		<div class="waveform" v-show="isListening">
			<canvas ref="waveCanvas" class="waveform-canvas"></canvas>
		</div>
	</div>
</template>

<style scoped>
.voice-footer {
	display: flex;
	align-items: center;
	gap: 0.75rem;
	padding: 0.5rem 0.75rem;
	position: relative; /* para referencia de medición */
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
.waveform-canvas {
	--waveform-stroke-color: var(--chat--color-primary, #6366f1);
}
.mic-button {
	position: relative;
	width: 58px;
	height: 58px;
	border-radius: 999px;
	border: 1px solid var(--chat--border-color);
	background: var(--chat--input--background, #fff);
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	outline: none;
	transition:
		transform 280ms cubic-bezier(0.22, 1, 0.36, 1),
		box-shadow 220ms ease;
}
.icon {
	position: relative;
	z-index: 2;
	width: 24px;
	height: 24px;
	transition: transform 80ms linear;
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

/* Dark mode overrides: mantener los estilos light como predeterminados */
@media (prefers-color-scheme: dark) {
	.mic-button {
		background: var(--chat--input--background, #0b1220);
		border-color: rgba(255, 255, 255, 0.14);
		color: #e5e7eb; /* icono */
	}
	.mic-button:hover {
		border-color: rgba(255, 255, 255, 0.22);
	}
	.dot {
		background: radial-gradient(
			circle at 50% 50%,
			rgba(34, 211, 238, 0.18),
			rgba(99, 102, 241, 0.08)
		);
	}
}
</style>
