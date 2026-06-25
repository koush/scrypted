// Minimal client for the Twelve Labs Analyze (Pegasus) API.
// https://docs.twelvelabs.io/v1.3/api-reference/analyze-videos
//
// Pegasus is a video understanding model: it takes a video (by URL or as
// base64 data) plus a natural language prompt, and returns a text description.
// This client intentionally covers only the analyze endpoint used by the
// plugin; it has no other dependencies so it is trivially unit testable.

export const DEFAULT_BASE_URL = 'https://api.twelvelabs.io/v1.3';
export const DEFAULT_MODEL = 'pegasus1.5';

export type PegasusVideo =
    | { type: 'url'; url: string }
    | { type: 'base64_string'; base64_string: string };

export interface PegasusAnalyzeRequest {
    video: PegasusVideo;
    prompt: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
}

export interface PegasusAnalyzeResult {
    id: string;
    data: string;
    finishReason?: string;
    outputTokens?: number;
}

// Build the JSON body for POST /analyze. Extracted so it can be unit tested
// without performing any network IO.
export function buildAnalyzeBody(req: PegasusAnalyzeRequest): Record<string, any> {
    if (!req.prompt)
        throw new Error('a prompt is required');
    if (!req.video)
        throw new Error('a video (url or base64) is required');

    const body: Record<string, any> = {
        model_name: req.modelName || DEFAULT_MODEL,
        stream: false,
        prompt: req.prompt,
        video: req.video,
    };
    if (req.temperature !== undefined)
        body.temperature = req.temperature;
    if (req.maxTokens !== undefined)
        body.max_tokens = req.maxTokens;
    return body;
}

export class PegasusClient {
    constructor(
        private apiKey: string,
        private baseUrl: string = DEFAULT_BASE_URL,
        // injectable for tests; defaults to global fetch (Node 18+).
        private fetchImpl: typeof fetch = fetch,
    ) {
        if (!apiKey)
            throw new Error('a Twelve Labs API key is required');
    }

    async analyze(req: PegasusAnalyzeRequest): Promise<PegasusAnalyzeResult> {
        const res = await this.fetchImpl(`${this.baseUrl}/analyze`, {
            method: 'POST',
            headers: {
                'x-api-key': this.apiKey,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(buildAnalyzeBody(req)),
        });

        const text = await res.text();
        if (!res.ok) {
            let message = text;
            try {
                message = JSON.parse(text).message || text;
            }
            catch {
                // not json; use raw text
            }
            throw new Error(`Twelve Labs analyze failed (${res.status}): ${message}`);
        }

        const json = JSON.parse(text);
        return {
            id: json.id,
            data: json.data,
            finishReason: json.finish_reason,
            outputTokens: json.usage?.output_tokens,
        };
    }
}
