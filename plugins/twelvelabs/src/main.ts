import sdk, {
    ChatCompletion,
    ChatCompletionCapabilities,
    ChatCompletionCreateParamsNonStreaming,
    ChatCompletionResponse,
    ScryptedDeviceBase,
    Setting,
    Settings,
    SettingValue,
} from '@scrypted/sdk';
import { StorageSettings } from '@scrypted/sdk/storage-settings';
import { extractAnalyzeInput } from './extract';
import { DEFAULT_BASE_URL, DEFAULT_MODEL, PegasusClient } from './pegasus';

// Twelve Labs Pegasus plugin: exposes a ChatCompletion device that describes
// video using the Twelve Labs Analyze (Pegasus) API. It is fully opt-in —
// nothing runs until the user enters an API key — and changes no Scrypted
// defaults. Point an NVR/notifier flow at this device to turn camera event
// clips into natural-language descriptions.
class TwelveLabsPlugin extends ScryptedDeviceBase implements Settings, ChatCompletion {
    storageSettings = new StorageSettings(this, {
        apiKey: {
            title: 'API Key',
            description: 'Twelve Labs API key. Get a free key with a generous free tier at https://twelvelabs.io.',
            type: 'password',
        },
        model: {
            title: 'Pegasus Model',
            description: 'The Pegasus model used for video understanding.',
            defaultValue: DEFAULT_MODEL,
            choices: ['pegasus1.5', 'pegasus1.2'],
        },
        baseUrl: {
            title: 'API Base URL',
            description: 'Override the Twelve Labs API base URL. Leave as default unless self-hosting a proxy.',
            defaultValue: DEFAULT_BASE_URL,
        },
    });

    // Pegasus understands video and produces text. It does not generate images
    // or audio, and the analyze endpoint requires a video input.
    chatCompletionCapabilities: ChatCompletionCapabilities = {
        image: true,
    };

    async getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        await this.storageSettings.putSetting(key, value);
    }

    private getClient(): PegasusClient {
        const apiKey = this.storageSettings.values.apiKey;
        if (!apiKey)
            throw new Error('Twelve Labs API key is not set. Configure it in the plugin settings.');
        return new PegasusClient(apiKey, this.storageSettings.values.baseUrl || DEFAULT_BASE_URL);
    }

    async getChatCompletion(body: ChatCompletionCreateParamsNonStreaming): Promise<ChatCompletionResponse> {
        const { prompt, video } = extractAnalyzeInput(body);
        const client = this.getClient();
        const result = await client.analyze({
            prompt,
            video,
            modelName: this.storageSettings.values.model || DEFAULT_MODEL,
            temperature: body.temperature ?? undefined,
            maxTokens: body.max_tokens ?? undefined,
        });

        const created = Math.floor(Date.now() / 1000);
        return {
            id: result.id,
            object: 'chat.completion',
            created,
            model: this.storageSettings.values.model || DEFAULT_MODEL,
            choices: [
                {
                    index: 0,
                    finish_reason: (result.finishReason as any) || 'stop',
                    logprobs: null,
                    message: {
                        role: 'assistant',
                        content: result.data,
                        refusal: null,
                    },
                },
            ],
            usage: {
                prompt_tokens: 0,
                completion_tokens: result.outputTokens ?? 0,
                total_tokens: result.outputTokens ?? 0,
            },
        } as ChatCompletionResponse;
    }

    // Pegasus analyze is request/response, not incremental. Wrap the result as a
    // single-chunk stream so streaming consumers still work.
    async streamChatCompletion(params: any, _newMessages?: any, callback?: any): Promise<any> {
        const completion = await this.getChatCompletion(params);
        const choice = completion.choices[0];

        const chunk: any = {
            id: completion.id,
            object: 'chat.completion.chunk',
            created: completion.created,
            model: completion.model,
            choices: [
                {
                    index: 0,
                    delta: { role: 'assistant', content: choice.message.content },
                    finish_reason: choice.finish_reason,
                    logprobs: null,
                },
            ],
        };

        if (typeof callback === 'function') {
            await callback(chunk);
            async function* single() {
                yield completion;
            }
            return single();
        }

        async function* stream() {
            yield chunk;
            yield completion;
        }
        return stream();
    }
}

export default TwelveLabsPlugin;
