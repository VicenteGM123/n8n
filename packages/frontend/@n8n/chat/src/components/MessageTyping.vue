<script lang="ts" setup>
import { computed, onMounted, ref, watch, nextTick } from 'vue';
import { useChat } from '@n8n/chat/composables';
import { chatEventBus } from '@n8n/chat/event-buses';

import type { ChatMessage } from '@n8n/chat/types';

import { Message } from './index';

const props = withDefaults(
	defineProps<{
		animation?: 'bouncing' | 'scaling';
		sender?: 'bot' | 'user';
	}>(),
	{
		animation: 'bouncing',
		sender: 'bot',
	},
);

const message: ChatMessage = {
	id: `typing-${props.sender}`,
	text: '',
	sender: props.sender,
};
const { agentThinkingtext } = useChat();

// Texto que se muestra para el bot
const displayText = computed(() => {
	if (props.sender === 'bot') {
		return agentThinkingtext?.value || 'Procesando mensaje...';
	}
	return '';
});

const messageContainer = ref<InstanceType<typeof Message>>();
const classes = computed(() => {
	return {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		'chat-message-typing': true,
		[`chat-message-typing-${props.sender}`]: true,
		[`chat-message-typing-animation-${props.animation}`]: true,
	};
});

onMounted(() => {
	nextTick(() => {
		chatEventBus.emit('scrollToBottom');
	});
});

// Watch for changes in agentThinkingtext and scroll when it changes
watch(
	() => agentThinkingtext?.value,
	(newText, oldText) => {
		if (newText !== oldText && newText && props.sender === 'bot') {
			nextTick(() => {
				chatEventBus.emit('scrollToBottom');
			});
		}
	},
	{ immediate: false },
);
</script>
<template>
	<Message
		ref="messageContainer"
		:class="classes"
		:message="message"
		:data-test-id="`chat-message-typing-${sender}`"
	>
		<!-- Bot: texto con animación shimmer -->
		<div v-if="sender === 'bot'" class="chat-message-typing-text">
			<span class="shimmer-text">{{ displayText }}</span>
		</div>

		<!-- Usuario: mantener animación de puntos actual -->
		<div v-else class="chat-message-typing-body">
			<span class="chat-message-typing-circle"></span>
			<span class="chat-message-typing-circle"></span>
			<span class="chat-message-typing-circle"></span>
		</div>
	</Message>
</template>
<style lang="scss">
.chat-message-typing {
	&.chat-message-typing-bot {
		max-width: fit-content; // Más ancho para el texto del bot
	}

	&.chat-message-typing-user {
		max-width: 80px; // Mantener tamaño pequeño para puntos
	}

	// Estilo para el texto del bot con animación shimmer
	.chat-message-typing-text {
		.shimmer-text {
			font-family: 'Geist Mono', ui-monospace, 'Roboto Mono', Menlo, Monaco, 'Liberation Mono',
				'DejaVu Sans Mono', 'Courier New', monospace;
			font-weight: 400;
			color: transparent;
			background: linear-gradient(90deg, #777 42%, #000 46%, #000 49%, #777 53%);
			background-size: 200% 100%;
			background-clip: text;
			-webkit-background-clip: text;
			animation: shimmer 3.2s infinite linear;
			position: relative;
		}
	}

	// Animación de puntos para el usuario (mantener original)
	&.chat-message-typing-animation-scaling .chat-message-typing-circle {
		animation: chat-message-typing-animation-scaling 800ms ease-in-out infinite;
		animation-delay: 3600ms;
	}

	&.chat-message-typing-animation-bouncing .chat-message-typing-circle {
		animation: chat-message-typing-animation-bouncing 800ms ease-in-out infinite;
		animation-delay: 3600ms;
	}

	.chat-message-typing-body {
		display: flex;
		justify-content: center;
		align-items: center;
	}

	.chat-message-typing-circle {
		display: block;
		height: 10px;
		width: 10px;
		border-radius: 50%;
		margin: 3px;

		&:nth-child(1) {
			animation-delay: 0ms;
		}

		&:nth-child(2) {
			animation-delay: 333ms;
		}

		&:nth-child(3) {
			animation-delay: 666ms;
		}
	}

	// Estilos específicos para mensajes del usuario
	&.chat-message-typing-user .chat-message-typing-circle {
		background-color: #f9f9f9;
	}

	// Estilos específicos para mensajes del bot (por defecto)
	&.chat-message-typing-bot .chat-message-typing-circle {
		background-color: var(--chat--color-typing, #9ca3af);
	}
}

// Animación shimmer para el texto del bot
@keyframes shimmer {
	0% {
		background-position: 200% 0;
	}
	100% {
		background-position: -200% 0;
	}
}

// Animaciones originales de los puntos (para usuario)
@keyframes chat-message-typing-animation-scaling {
	0% {
		transform: scale(1);
	}
	33% {
		transform: scale(1);
	}
	50% {
		transform: scale(1.4);
	}
	100% {
		transform: scale(1);
	}
}

@keyframes chat-message-typing-animation-bouncing {
	0% {
		transform: translateY(0);
	}
	33% {
		transform: translateY(0);
	}
	50% {
		transform: translateY(-10px);
	}
	100% {
		transform: translateY(0);
	}
}
</style>
