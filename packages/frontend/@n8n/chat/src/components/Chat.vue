<script setup lang="ts">
import { nextTick, onMounted, ref, computed } from 'vue';

import GetStarted from '@n8n/chat/components/GetStarted.vue';
import GetStartedFooter from '@n8n/chat/components/GetStartedFooter.vue';
import Input from '@n8n/chat/components/Input.vue';
import Layout from '@n8n/chat/components/Layout.vue';
import MessagesList from '@n8n/chat/components/MessagesList.vue';
import VoiceChat from '@n8n/chat/components/VoiceChat.vue';
import { useI18n, useChat, useOptions } from '@n8n/chat/composables';
import { chatEventBus } from '@n8n/chat/event-buses';

const { t } = useI18n();
const chatStore = useChat();

const { messages, currentSessionId } = chatStore;
const { options } = useOptions();

// Modo de chat: texto o voz
const chatMode = ref<'text' | 'voice'>('text');
function toggleChatMode() {
	chatMode.value = chatMode.value === 'text' ? 'voice' : 'text';
}

// Mostrar/ocultar toggle según opción de i18n: t('chatMode') === false
const showToggle = computed(() => {
	const v = t('chatMode') as unknown as any;
	return !(v === false || v === 'false' || v === '0' || v === 0 || v === 'off' || v === 'disabled');
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
					<button
						class="chat-toggle-mode-button"
						v-if="showToggle"
						:title="chatMode === 'text' ? 'Cambiar a chat por voz' : 'Cambiar a chat por texto'"
						aria-label="Alternar modo de chat"
						@click="toggleChatMode"
					>
						{{ chatMode === 'text' ? '🎤' : '💬' }}
					</button>
				</div>
			</div>
		</template>

		<!-- Contenido principal: siempre mostrar mensajes o pantalla de bienvenida -->
		<GetStarted v-if="!currentSessionId && options.showWelcomeScreen" @click:button="getStarted" />
		<MessagesList v-else :messages="messages" />

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

.chat-toggle-mode-button {
	border: none;
	background: none;
	cursor: pointer;
	font-size: 1.1rem;
	line-height: 1;
	padding: 0.25rem;
}
</style>
