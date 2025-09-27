import type { ChatOptions } from '@n8n/chat/types';

export function buildRequestMetadataFromElementId(
	options: ChatOptions,
): Record<string, unknown> | undefined {
	const base = options.metadata ?? {};
	const id = options.metadataElementId;
	if (!id) return Object.keys(base).length ? base : undefined;
	if (typeof window === 'undefined' || !document)
		return Object.keys(base).length ? base : undefined;
	const el = document.getElementById(id);
	if (!el) return Object.keys(base).length ? base : undefined;
	const html = el.innerHTML;
	if (!html) return Object.keys(base).length ? base : undefined;
	return { ...base, pageHtml: html };
}
