import type { ChatOptions } from '@n8n/chat/types';

export const defaultOptions: ChatOptions = {
	webhookUrl: 'http://localhost:5678',
	webhookConfig: {
		method: 'POST',
		headers: {},
	},
	target: '#n8n-chat',
	mode: 'window',
	loadPreviousSession: true,
	chatInputKey: 'chatInput',
	chatSessionKey: 'sessionId',
	defaultLanguage: 'en',
	showWelcomeScreen: false,
	initialMessages: ['Hola, ¿en qué te puedo ayudar?'],
	i18n: {
		en: {
			title: 'Turnex Copilot',
			subtitle: 'Háblame para ayudarte con Turnex',
			footer: '',
			getStarted: 'New Conversation',
			inputPlaceholder: 'Type your question..',
			closeButtonTooltip: 'Close chat',
		},
	},
	theme: {},
	enableStreaming: false,
	chatMode: 'text',
};

export const defaultMountingTarget = '#n8n-chat';
