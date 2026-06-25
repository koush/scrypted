// Pull the prompt text and a single video source out of an OpenAI-shaped
// ChatCompletion request body. Kept pure (no network, no SDK) so it can be
// unit tested directly.
//
// Pegasus is video-native, so we look for a video reference in the message
// content. Two forms are supported:
//   - an http(s) URL to a video file (image_url / video_url / input_video parts,
//     or a bare URL in text)
//   - a data: URL carrying base64 video bytes (e.g. a Scrypted event clip)
// Image-only inputs are rejected with a clear error, since Pegasus analyzes
// video, not stills.

import type { PegasusVideo } from './pegasus';

export interface ExtractedAnalyzeInput {
    prompt: string;
    video: PegasusVideo;
}

const VIDEO_URL_RE = /\bhttps?:\/\/\S+\.(?:mp4|mov|m4v|webm|mkv|avi|ts)\b/i;
const DATA_VIDEO_RE = /^data:video\/[^;]+;base64,(.+)$/i;

function urlToVideo(url: string): PegasusVideo | undefined {
    const data = DATA_VIDEO_RE.exec(url);
    if (data)
        return { type: 'base64_string', base64_string: data[1] };
    if (/^https?:\/\//i.test(url))
        return { type: 'url', url };
    return undefined;
}

// Collect plain text and candidate URLs from a single message's content,
// which per the OpenAI schema is either a string or an array of content parts.
function collectFromContent(content: any, texts: string[], urls: string[]) {
    if (content == null)
        return;
    if (typeof content === 'string') {
        texts.push(content);
        return;
    }
    if (!Array.isArray(content))
        return;
    for (const part of content) {
        if (typeof part === 'string') {
            texts.push(part);
            continue;
        }
        if (typeof part?.text === 'string')
            texts.push(part.text);
        // image_url is the standard vision part; we reuse it (and the
        // analogous video_url / input_video forms) to carry a video reference.
        const url = part?.image_url?.url
            ?? part?.video_url?.url
            ?? part?.input_video?.url
            ?? (typeof part?.url === 'string' ? part.url : undefined);
        if (typeof url === 'string')
            urls.push(url);
    }
}

export function extractAnalyzeInput(body: any): ExtractedAnalyzeInput {
    const messages: any[] = Array.isArray(body?.messages) ? body.messages : [];
    const texts: string[] = [];
    const urls: string[] = [];

    for (const message of messages)
        collectFromContent(message?.content, texts, urls);

    let video: PegasusVideo | undefined;
    // Prefer an explicit URL/data part.
    for (const url of urls) {
        const v = urlToVideo(url);
        if (v) {
            video = v;
            break;
        }
    }
    // Fall back to a video URL embedded in the prompt text. Strip the matched
    // URL out so it doesn't leak into the prompt Pegasus receives.
    if (!video) {
        for (let i = 0; i < texts.length; i++) {
            const match = VIDEO_URL_RE.exec(texts[i]);
            if (match) {
                video = { type: 'url', url: match[0] };
                texts[i] = texts[i].replace(match[0], '');
                break;
            }
        }
    }

    if (!video)
        throw new Error('no video found in the request. Twelve Labs Pegasus analyzes video; provide a video URL or a base64 video data: URL in the message content.');

    const prompt = texts.map(t => t.trim()).filter(Boolean).join('\n').trim()
        || 'Describe what happens in this video.';

    return { prompt, video };
}
