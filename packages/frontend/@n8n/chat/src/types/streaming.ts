export type ChunkType = 'begin' | 'item' | 'end' | 'error';

export type ObjectContent = {
	text_chunk: string;
	metadata?: {
		operation?: 'toolCall' | 'response' | 'inputUpdate';
		operationData?: {
			selectorId?: string;
			text?: string;
		};
		// Allow additional metadata without strict typing for forward compatibility
		[key: string]: unknown;
	};
};

export interface StructuredChunk {
	type: ChunkType;
	// Content can be a plain string (backwards compatible) or an object with text_chunk/metadata
	content?: string | ObjectContent;
	metadata: {
		nodeId: string;
		nodeName: string;
		timestamp: number;
		runIndex: number;
		itemIndex: number;
	};
}

export interface NodeStreamingState {
	nodeId: string;
	chunks: string[];
	isActive: boolean;
	startTime: number;
}
