import { get, post, postWithFiles } from '@n8n/chat/api/generic';
import { buildRequestMetadataFromElementId } from '@n8n/chat/utils';
import type {
	ChatOptions,
	LoadPreviousSessionResponse,
	SendMessageResponse,
	StructuredChunk,
	ObjectContent,
} from '@n8n/chat/types';

export async function loadPreviousSession(sessionId: string, options: ChatOptions) {
	const method = options.webhookConfig?.method === 'POST' ? post : get;
	return await method<LoadPreviousSessionResponse>(
		`${options.webhookUrl}`,
		{
			action: 'loadPreviousSession',
			[options.chatSessionKey as string]: sessionId,
			...(options.metadata ? { metadata: options.metadata } : {}),
		},
		{
			headers: options.webhookConfig?.headers,
		},
	);
}

export async function sendMessage(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
) {
	const mergedMetadata = buildRequestMetadataFromElementId(options);
	if (files.length > 0) {
		return await postWithFiles<SendMessageResponse>(
			`${options.webhookUrl}`,
			{
				action: 'sendMessage',
				[options.chatSessionKey as string]: sessionId,
				[options.chatInputKey as string]: message,
				...(mergedMetadata ? { metadata: mergedMetadata } : {}),
			},
			files,
			{
				headers: options.webhookConfig?.headers,
			},
		);
	}
	const method = options.webhookConfig?.method === 'POST' ? post : get;
	return await method<SendMessageResponse>(
		`${options.webhookUrl}`,
		{
			action: 'sendMessage',
			[options.chatSessionKey as string]: sessionId,
			[options.chatInputKey as string]: message,
			...(mergedMetadata ? { metadata: mergedMetadata } : {}),
		},
		{
			headers: options.webhookConfig?.headers,
		},
	);
}

// Create a transform stream that parses newline-delimited JSON
function createLineParser(): TransformStream<Uint8Array, StructuredChunk> {
	let buffer = '';
	const decoder = new TextDecoder();

	return new TransformStream({
		transform(chunk, controller) {
			buffer += decoder.decode(chunk, { stream: true });

			// Process all complete lines in the buffer
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

			for (const line of lines) {
				if (line.trim()) {
					try {
						const parsed = JSON.parse(line) as StructuredChunk;
						controller.enqueue(parsed);
					} catch (error) {
						// Handle non-JSON lines as plain text
						controller.enqueue({
							type: 'item',
							content: line,
						} as StructuredChunk);
					}
				}
			}
		},

		flush(controller) {
			// Process any remaining buffer content
			if (buffer.trim()) {
				try {
					const parsed = JSON.parse(buffer) as StructuredChunk;
					controller.enqueue(parsed);
				} catch (error) {
					controller.enqueue({
						type: 'item',
						content: buffer,
					} as StructuredChunk);
				}
			}
		},
	});
}

export interface StreamingEventHandlers {
	onBeginMessage: (nodeId: string, runIndex?: number) => void;
	// Final answer chunks (operation=response or plain string)
	onChunk: (chunk: string, nodeId?: string, runIndex?: number) => void;
	// Interim tool call thoughts/actions text (operation=toolCall)
	onToolCallText?: (chunk: string, nodeId?: string, runIndex?: number) => void;
	// Signal to clear interim tool text once final response starts or stream ends
	onToolCallEnd?: (nodeId?: string, runIndex?: number) => void;
	onEndMessage: (nodeId: string, runIndex?: number) => void;
}

export async function sendMessageStreaming(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
	handlers: StreamingEventHandlers,
): Promise<{ hasReceivedChunks: boolean }> {
	// Build request
	const response = await (files.length > 0
		? sendWithFiles(message, files, sessionId, options)
		: sendTextOnly(message, sessionId, options));

	if (!response.ok) {
		const errorText = await response.text();
		console.error('HTTP error response:', response.status, errorText);
		throw new Error(`Error while sending message. Error: ${errorText}`);
	}

	if (!response.body) {
		throw new Error('Response body is not readable');
	}

	// Process the stream
	const reader = response.body.pipeThrough(createLineParser()).getReader();
	let hasReceivedChunks = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			const nodeId = value.metadata?.nodeId || 'unknown';
			const runIndex = value.metadata?.runIndex;

			switch (value.type) {
				case 'begin':
					handlers.onBeginMessage(nodeId, runIndex);
					break;
				case 'item':
					hasReceivedChunks = true;
					if (typeof value.content === 'string' || value.content === undefined) {
						handlers.onChunk((value.content as string) ?? '', nodeId, runIndex);
					} else {
						const obj = value.content as ObjectContent;
						const operation = obj.metadata?.operation;
						const text = obj.text_chunk ?? '';
						if (operation === 'toolCall') {
							handlers.onToolCallText?.(text, nodeId, runIndex);
						} else if (operation === 'inputUpdate') {
							// Manejar actualización de elementos DOM
							const operationData = obj.metadata?.operationData;
							if (
								operationData &&
								typeof operationData.selectorId === 'string' &&
								typeof operationData.text === 'string'
							) {
								handleInputUpdate(operationData.selectorId, operationData.text);
							} else {
								console.log('inputUpdate: operationData inválida o incompleta:', operationData);
							}
						} else if (operation === 'response') {
							// Clear interim tool text and forward final chunk
							handlers.onToolCallEnd?.(nodeId, runIndex);
							handlers.onChunk(text, nodeId, runIndex);
						} else {
							handlers.onChunk(text, nodeId, runIndex);
						}
					}
					break;
				case 'end':
					// Ensure interim tool text is cleared at end
					handlers.onToolCallEnd?.(nodeId, runIndex);
					handlers.onEndMessage(nodeId, runIndex);
					break;
				case 'error':
					hasReceivedChunks = true;
					handlers.onChunk(`Error: ${value.content ?? 'Unknown error'}`, nodeId, runIndex);
					handlers.onEndMessage(nodeId, runIndex);
					break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	return { hasReceivedChunks };
}

// Helper function for file uploads
async function sendWithFiles(
	message: string,
	files: File[],
	sessionId: string,
	options: ChatOptions,
): Promise<Response> {
	const formData = new FormData();
	formData.append('action', 'sendMessage');
	formData.append(options.chatSessionKey as string, sessionId);
	formData.append(options.chatInputKey as string, message);

	const mergedMetadata = buildRequestMetadataFromElementId(options);
	if (mergedMetadata) {
		formData.append('metadata', JSON.stringify(mergedMetadata));
	}

	for (const file of files) {
		formData.append('files', file);
	}

	return await fetch(options.webhookUrl, {
		method: 'POST',
		headers: {
			Accept: 'text/plain',
			...options.webhookConfig?.headers,
		},
		body: formData,
	});
}

// Helper function for text-only messages
async function sendTextOnly(
	message: string,
	sessionId: string,
	options: ChatOptions,
): Promise<Response> {
	const mergedMetadata = buildRequestMetadataFromElementId(options);
	const body = {
		action: 'sendMessage',
		[options.chatSessionKey as string]: sessionId,
		[options.chatInputKey as string]: message,
		...(mergedMetadata ? { metadata: mergedMetadata } : {}),
	};

	return await fetch(options.webhookUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Accept: 'text/plain',
			...options.webhookConfig?.headers,
		},
		body: JSON.stringify(body),
	});
}

/**
 * Función auxiliar para manejar actualizaciones de elementos DOM
 * @param selectorId - ID del elemento (puede incluir # o no)
 * @param text - Texto para actualizar el contenido
 */
function handleInputUpdate(selectorId: string, text: string): void {
	// Validaciones de tipos
	if (typeof selectorId !== 'string') {
		console.log('handleInputUpdate: selectorId debe ser un string, recibido:', typeof selectorId);
		return;
	}

	if (typeof text !== 'string') {
		console.log('handleInputUpdate: text debe ser un string, recibido:', typeof text);
		return;
	}

	// Preparar el selector
	let selector = selectorId;
	if (!selectorId.startsWith('#')) {
		selector = `#${selectorId}`;
	}

	// Buscar el elemento
	let element = document.querySelector(selector);

	// Fallback: si no funciona, intentar con el selectorId original
	if (!element && selector !== selectorId) {
		element = document.querySelector(selectorId);
	}

	// Validar que el elemento existe
	if (!element) {
		console.log(
			'handleInputUpdate: No se pudo encontrar el elemento con selector:',
			selector,
			'o fallback:',
			selectorId,
		);
		return;
	}

	// Actualizar el contenido
	try {
		if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
			element.value = text;
		} else {
			element.textContent = text;
		}
	} catch (error) {
		console.log('handleInputUpdate: Error al actualizar el contenido del elemento:', error);
	}
}
