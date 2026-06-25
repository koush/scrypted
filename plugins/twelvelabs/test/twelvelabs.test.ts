// Unit tests for the pure (no-network) pieces of the Twelve Labs plugin, plus
// an optional live smoke test gated on TWELVELABS_API_KEY.
//
// Run: npm test   (uses node --test --experimental-strip-types)

import assert from 'node:assert';
import { test } from 'node:test';
import { buildAnalyzeBody, DEFAULT_MODEL, PegasusClient } from '../src/pegasus.ts';
import { extractAnalyzeInput } from '../src/extract.ts';

test('buildAnalyzeBody sets required fields and defaults', () => {
    const body = buildAnalyzeBody({
        prompt: 'what happens?',
        video: { type: 'url', url: 'https://example.com/clip.mp4' },
    });
    assert.equal(body.model_name, DEFAULT_MODEL);
    assert.equal(body.stream, false);
    assert.equal(body.prompt, 'what happens?');
    assert.deepEqual(body.video, { type: 'url', url: 'https://example.com/clip.mp4' });
    // optional fields omitted when not provided
    assert.ok(!('temperature' in body));
    assert.ok(!('max_tokens' in body));
});

test('buildAnalyzeBody forwards model, temperature and maxTokens', () => {
    const body = buildAnalyzeBody({
        prompt: 'describe',
        video: { type: 'base64_string', base64_string: 'AAAA' },
        modelName: 'pegasus1.2',
        temperature: 0.3,
        maxTokens: 256,
    });
    assert.equal(body.model_name, 'pegasus1.2');
    assert.equal(body.temperature, 0.3);
    assert.equal(body.max_tokens, 256);
    assert.deepEqual(body.video, { type: 'base64_string', base64_string: 'AAAA' });
});

test('buildAnalyzeBody rejects missing prompt or video', () => {
    assert.throws(() => buildAnalyzeBody({ prompt: '', video: { type: 'url', url: 'https://x/y.mp4' } }), /prompt/);
    assert.throws(() => buildAnalyzeBody({ prompt: 'hi', video: undefined as any }), /video/);
});

test('extractAnalyzeInput pulls a video_url part and joins prompt text', () => {
    const { prompt, video } = extractAnalyzeInput({
        messages: [
            { role: 'system', content: 'You are a security camera analyst.' },
            {
                role: 'user',
                content: [
                    { type: 'text', text: 'What is the person doing?' },
                    { type: 'video_url', video_url: { url: 'https://nvr.local/event.mp4' } },
                ],
            },
        ],
    });
    assert.deepEqual(video, { type: 'url', url: 'https://nvr.local/event.mp4' });
    assert.match(prompt, /security camera analyst/);
    assert.match(prompt, /What is the person doing\?/);
});

test('extractAnalyzeInput accepts an image_url part carrying a video and data: URLs', () => {
    const fromImageUrl = extractAnalyzeInput({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/clip.mov' } }] }],
    });
    assert.deepEqual(fromImageUrl.video, { type: 'url', url: 'https://x/clip.mov' });

    const fromData = extractAnalyzeInput({
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:video/mp4;base64,QUJD' } }] }],
    });
    assert.deepEqual(fromData.video, { type: 'base64_string', base64_string: 'QUJD' });
});

test('extractAnalyzeInput finds a bare video URL in the prompt text and defaults the prompt', () => {
    const { prompt, video } = extractAnalyzeInput({
        messages: [{ role: 'user', content: 'https://nvr.local/clip.mp4' }],
    });
    assert.deepEqual(video, { type: 'url', url: 'https://nvr.local/clip.mp4' });
    assert.equal(prompt, 'Describe what happens in this video.');
});

test('extractAnalyzeInput throws a clear error when no video is present', () => {
    assert.throws(
        () => extractAnalyzeInput({ messages: [{ role: 'user', content: 'just text, no clip' }] }),
        /no video found/,
    );
});

test('PegasusClient.analyze posts to /analyze and maps the response', async () => {
    let captured: { url: string; init: any } | undefined;
    const fakeFetch = (async (url: any, init: any) => {
        captured = { url, init };
        return {
            ok: true,
            status: 200,
            text: async () =>
                JSON.stringify({ id: 'a1', data: 'A dog runs across a yard.', finish_reason: 'stop', usage: { output_tokens: 7 } }),
        } as any;
    }) as unknown as typeof fetch;

    const client = new PegasusClient('test-key', 'https://api.twelvelabs.io/v1.3', fakeFetch);
    const result = await client.analyze({ prompt: 'describe', video: { type: 'url', url: 'https://x/y.mp4' } });

    assert.equal(captured!.url, 'https://api.twelvelabs.io/v1.3/analyze');
    assert.equal(captured!.init.method, 'POST');
    assert.equal(captured!.init.headers['x-api-key'], 'test-key');
    assert.deepEqual(result, { id: 'a1', data: 'A dog runs across a yard.', finishReason: 'stop', outputTokens: 7 });
});

test('PegasusClient.analyze surfaces API error messages', async () => {
    const fakeFetch = (async () => ({
        ok: false,
        status: 400,
        text: async () => JSON.stringify({ message: 'video_file_broken' }),
    } as any)) as unknown as typeof fetch;

    const client = new PegasusClient('k', undefined, fakeFetch);
    await assert.rejects(
        () => client.analyze({ prompt: 'p', video: { type: 'url', url: 'https://x/y.mp4' } }),
        /400.*video_file_broken/,
    );
});

// Opt-in live smoke test: only runs when TWELVELABS_API_KEY is set. Confirms the
// request wiring against the real Analyze endpoint. The call may legitimately
// return a content error for a given sample URL; we only assert that auth and
// the request schema are accepted (i.e. not a 401/invalid-field rejection).
test('live: analyze request is accepted by the API', { skip: !process.env.TWELVELABS_API_KEY }, async () => {
    const client = new PegasusClient(process.env.TWELVELABS_API_KEY!);
    try {
        const res = await client.analyze({
            prompt: 'Describe what happens in this video in one sentence.',
            video: { type: 'url', url: 'https://download.samplelib.com/mp4/sample-10s.mp4' },
        });
        assert.equal(typeof res.data, 'string');
    }
    catch (e: any) {
        // Auth / schema problems are real failures; content errors are not.
        assert.doesNotMatch(String(e?.message), /\(401\)|\(403\)|invalid|model_name|unknown field/i, String(e?.message));
    }
});
