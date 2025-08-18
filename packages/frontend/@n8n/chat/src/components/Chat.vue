<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, computed } from 'vue';

import GetStarted from '@n8n/chat/components/GetStarted.vue';
import GetStartedFooter from '@n8n/chat/components/GetStartedFooter.vue';
import Input from '@n8n/chat/components/Input.vue';
import Layout from '@n8n/chat/components/Layout.vue';
import MessagesList from '@n8n/chat/components/MessagesList.vue';
import VoiceChat from '@n8n/chat/components/VoiceChat.vue';
import { useI18n, useChat, useOptions } from '@n8n/chat/composables';
import { chatEventBus } from '@n8n/chat/event-buses';
import IconChat from 'virtual:icons/mdi/chatOutline';
import IconMic from 'virtual:icons/mdi/microphone';

const { t } = useI18n();
const chatStore = useChat();

const { messages, currentSessionId } = chatStore;
const { options } = useOptions();

// Modo de chat: texto o voz; si options.chatMode es 'text' o 'voice', arrancamos en ese modo
const chatMode = ref<'text' | 'voice'>(options.chatMode === 'voice' ? 'voice' : 'text');
const speaking = ref(false);
const speakLevel = ref(0);
const indicatorActive = ref(false);
const indicatorLevel = ref(0);
const userTyping = ref(false);
const onSpeakStart = () => {
	indicatorActive.value = true;
	speaking.value = true;
};
const onSpeakStop = () => {
	indicatorActive.value = false;
	speaking.value = false;
	speakLevel.value = 0;
	indicatorLevel.value = 0;
};
const onSpeakLevel = (lvl: number) => {
	speakLevel.value = lvl || 0;
	indicatorLevel.value = lvl || 0;
};
const onUserTypingStart = () => {
	userTyping.value = true;
};
const onUserTypingStop = () => {
	userTyping.value = false;
};

// Mostrar/ocultar toggle según options.chatMode === 'toggle'
const showToggle = computed(() => {
	return true;
	options.chatMode === 'toggle';
});

async function getStarted() {
	if (!chatStore.startNewSession) {
		return;
	}
	void chatStore.startNewSession();
	void nextTick(() => {
		chatEventBus.emit('scrollToBottom');
	});
}

async function initialize() {
	if (!chatStore.loadPreviousSession) {
		return;
	}
	await chatStore.loadPreviousSession();
	void nextTick(() => {
		chatEventBus.emit('scrollToBottom');
	});
}

onMounted(async () => {
	await initialize();
	if (!options.showWelcomeScreen && !currentSessionId.value) {
		await getStarted();
	}
	chatEventBus.on('speaking:start', onSpeakStart);
	chatEventBus.on('speaking:stop', onSpeakStop);
	chatEventBus.on('speaking:level', onSpeakLevel);
	chatEventBus.on('voice:user-typing:start', onUserTypingStart);
	chatEventBus.on('voice:user-typing:stop', onUserTypingStop);
});

onUnmounted(() => {
	chatEventBus.off('speaking:start', onSpeakStart);
	chatEventBus.off('speaking:stop', onSpeakStop);
	chatEventBus.off('speaking:level', onSpeakLevel);
	chatEventBus.off('voice:user-typing:start', onUserTypingStart);
	chatEventBus.off('voice:user-typing:stop', onUserTypingStop);
});
</script>

<template>
	<Layout class="chat-wrapper">
		<template #header>
			<div class="chat-heading">
				<div class="avatar" aria-hidden="true"></div>
				<div class="meta">
					<div class="title">
						{{ t('title') }}
					</div>
					<div class="status" v-if="t('subtitle')">{{ t('subtitle') }}</div>
				</div>
				<div class="actions">
					<div v-if="showToggle" class="mode-toggle" role="group" aria-label="Modo de chat">
						<button
							class="toggle-segment"
							:class="{ active: chatMode === 'text' }"
							@click="chatMode = 'text'"
							title="Chat por texto"
							:aria-pressed="chatMode === 'text'"
						>
							<IconChat class="toggle-icon" />
						</button>
						<button
							class="toggle-segment"
							:class="{ active: chatMode === 'voice' }"
							@click="chatMode = 'voice'"
							title="Chat por voz"
							:aria-pressed="chatMode === 'voice'"
						>
							<IconMic class="toggle-icon" />
						</button>
					</div>
				</div>
			</div>
		</template>

		<!-- Contenido principal: siempre mostrar mensajes o pantalla de bienvenida -->

		<div
			v-if="chatMode === 'voice'"
			class="speaking-indicator"
			:class="{ active: indicatorActive }"
			:style="{ '--speak-level': indicatorActive ? indicatorLevel.toFixed(2) : '0' }"
		>
			<div class="ring">
				<div class="wave"></div>
			</div>
		</div>

		<GetStarted v-if="!currentSessionId && options.showWelcomeScreen" @click:button="getStarted" />
		<MessagesList v-else :messages="messages" :user-typing="userTyping" />
		<!-- Footer del layout: alterna entre Input (texto) y VoiceChat (voz) -->
		<template #footer>
			<template v-if="chatMode === 'text'">
				<Input v-if="currentSessionId" />
				<GetStartedFooter v-else />
			</template>
			<template v-else>
				<VoiceChat v-if="currentSessionId" />
				<GetStartedFooter v-else />
			</template>
		</template>
	</Layout>
</template>

<style lang="scss">
.chat-close-button {
	display: flex;
	border: none;
	background: none;
	cursor: pointer;

	&:hover {
		color: var(--chat--close--button--color-hover, var(--chat--color-primary));
	}
}

/* ====== Header ====== */

.chat-heading {
	display: flex;
	flex-direction: row;
	align-items: center;
	gap: 0.75rem;
	padding: 0.4rem 0.6rem;
}
.chat-heading .avatar {
	width: 36px;
	height: 36px;
	border-radius: 999px;
	background: radial-gradient(circle at 30% 30%, #22d3ee, #6366f1 60%, #a78bfa);
	box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.15);
	flex: 0 0 auto;
}
.chat-heading .meta {
	display: grid;
}
.chat-heading .title {
	font-weight: 700;
	font-size: 0.98rem;
}
.chat-heading .status {
	font-size: 0.8rem;
	color: var(--muted);
}
.chat-heading .actions {
	margin-left: auto;
	display: flex;
	gap: 0.5rem;
}

/* Toggle moderno */
.mode-toggle {
	display: inline-flex;
	background: #f3f4f6;
	border: 1px solid #e5e7eb;
	border-radius: 999px;
	padding: 4px;
	gap: 4px;
}
.toggle-segment {
	border: none;
	background: transparent;
	color: #6366f1;
	width: 32px;
	height: 32px;
	border-radius: 999px;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.2rem;
	cursor: pointer;
	opacity: 0.6;
	transition:
		background 0.2s,
		color 0.2s;
}
.toggle-segment.active {
	background: #6366f1;
	color: #fff;
	opacity: 1;
}
.toggle-icon {
	width: 18px;
	height: 18px;
}

/* Dark mode overrides */
@media (prefers-color-scheme: dark) {
	.mode-toggle {
		background: #0b1220; /* deep background */
		border-color: #24304a; /* subtle border */
	}
	.toggle-segment {
		color: #c7d2fe; /* indigo-200 */
	}
	.toggle-segment:hover {
		background: rgba(99, 102, 241, 0.12);
	}
	.toggle-segment.active {
		background: #6366f1; /* indigo-500 */
		color: #fff;
	}
}
.speaking-indicator {
	position: sticky;
	top: 8px;
	z-index: 2;
	display: flex;
	justify-content: center;
	padding: 8px 0;
}
// speaking indicator base
.speaking-indicator .ring {
	width: 56px;
	height: 56px;
	border-radius: 999px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	display: grid;
	place-items: center;
	transition: transform 400ms cubic-bezier(0.22, 1, 0.36, 1);
	overflow: hidden;
}
.speaking-indicator.active .ring {
	/* Grow more when speaking, modulate by level */
	transform: scale(calc(1.3 + (var(--speak-level, 0) * 0.3)));
	transition: transform 120ms ease-out;
}

.speaking-indicator .wave {
	width: 120%;
	height: 120%;
	background: conic-gradient(#60a5fa, #22d3ee, #34d399, #f59e0b, #f472b6, #a78bfa, #60a5fa);
	opacity: 1;
}
.speaking-indicator.active .wave {
	animation: swirl 3s linear infinite;
}

@keyframes swirl {
	from {
		transform: rotate(0deg);
	}
	to {
		transform: rotate(360deg);
	}
}
</style>
