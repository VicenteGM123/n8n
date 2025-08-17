import type { ChatOptions } from '@n8n/chat/types';

export type VoiceRequestType = 'newConnection' | 'message';

export interface VoiceConnectResponse {
	connectionId: string;
}

export interface VoiceMessageResponse {
	// free-form: your n8n webhook can return anything; minimally text
	text?: string;
	// you may include audioUrl or binary data later
	audioUrl?: string;
}

export async function voiceConnect(options: ChatOptions) {
	if (!options.webhookUrl) throw new Error('voiceWebhookUrl is not configured');
	const res = await fetch(options.webhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(options.voiceWebhookConfig?.headers || {}),
		},
		body: JSON.stringify({ requestType: 'newConnection' as VoiceRequestType }),
	});
	if (!res.ok) throw new Error(`Voice connect failed: ${res.status}`);
	return (await res.json()) as VoiceConnectResponse;
}

export async function voiceSendMessage(
	connectionId: string,
	payload: { text?: string; audio?: Blob },
	options: ChatOptions,
) {
	if (!options.webhookUrl) throw new Error('voiceWebhookUrl is not configured');

	if (payload.audio) {
		const form = new FormData();
		form.append('requestType', 'message');
		form.append('connectionId', connectionId);
		form.append('audio', payload.audio, 'audio.webm');
		const res = await fetch(options.webhookUrl, {
			method: 'POST',
			headers: { ...(options.voiceWebhookConfig?.headers || {}) },
			body: form,
		});
		if (!res.ok) throw new Error(`Voice message failed: ${res.status}`);
		return (await res.json()) as VoiceMessageResponse;
	}

	const res = await fetch(options.webhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(options.voiceWebhookConfig?.headers || {}),
		},
		body: JSON.stringify({ requestType: 'message', connectionId, text: payload.text ?? '' }),
	});
	if (!res.ok) throw new Error(`Voice message failed: ${res.status}`);
	return (await res.json()) as VoiceMessageResponse;
}
