import { connectCameraAPI, OnvifCameraAPI } from '../onvif-api';

export function isReolinkDoorbell(channelInfo?: { typeInfo?: string }) {
    const model = channelInfo?.typeInfo;
    return typeof model === 'string' && model.toLowerCase().includes('doorbell');
}

function booleanValue(value: unknown): boolean | undefined {
    if (value === true || value === 1 || value === 'true' || value === '1')
        return true;
    if (value === false || value === 0 || value === 'false' || value === '0')
        return false;
}

function simpleItems(value: any): { Name?: string, Value?: unknown }[] {
    if (!value)
        return [];
    return (Array.isArray(value) ? value : [value]).map(item => item?.$ || {});
}

// Preserve the ONVIF source rather than using the standalone camera's binary
// events, which deliberately have no channel identity.
export function parseVisitorEvent(event: any): { channel?: number, state: boolean } | undefined {
    const topic = typeof event?.topic === 'string' ? event.topic : event?.topic?._;
    if (typeof topic !== 'string' || topic.split('/').pop().split(':').pop() !== 'Visitor')
        return;
    const message = event?.message?.message;
    // Subscription initialization can replay an old press after reconnecting.
    const operation = message?.$?.PropertyOperation;
    if (operation && operation !== 'Changed')
        return;
    const data = simpleItems(message?.data?.simpleItem);
    const state = booleanValue(data.find(item => item.Name === 'State')?.Value
        ?? (data.length === 1 ? data[0].Value : undefined));
    if (state === undefined)
        return;
    const sourceItems = simpleItems(message?.source?.simpleItem);
    const primarySources = sourceItems.filter(item => item.Name === 'Source');
    // Reolink uses Source for channel identity. Like reolink-aio, only fall
    // back to the configuration token when Source is absent: a configuration
    // token need not itself be a numeric channel.
    const sources = primarySources.length ? primarySources
        : sourceItems.filter(item => item.Name === 'VideoSourceConfigurationToken');
    const channels = sources.map(item => {
        const token = String(item.Value);
        return token.length && [...token].every(character => character >= '0' && character <= '9')
            ? Number(token) : NaN;
    });
    const channel = channels.length && channels.every(value => Number.isSafeInteger(value) && value === channels[0])
        ? channels[0] : undefined;
    return { channel, state };
}

/** One pull-point subscription per NVR. ONVIF waits for events, rather than
 * repeatedly querying button state. Failed subscriptions retry after a minute. */
export class ReolinkDoorbellEvents {
    active = false;
    private client: OnvifCameraAPI;
    private pending: Promise<void>;
    private retryAfter = 0;
    private stopped = false;
    private warnedMissingChannel = false;

    constructor(private address: string, private username: string, private password: string,
        private console: Console, private onVisitor: (channel: number, state: boolean) => void,
        private debug = () => false) {
    }

    private onEvent = (event: any) => {
        if (this.debug())
            this.console.debug('ONVIF doorbell subscription event:', JSON.stringify(event));
        const visitor = parseVisitorEvent(event);
        if (visitor?.channel === undefined) {
            if (visitor && !this.warnedMissingChannel) {
                this.warnedMissingChannel = true;
                this.console.warn('Ignoring ONVIF doorbell event without a valid channel source.');
            }
        }
        else
            this.onVisitor(visitor.channel, visitor.state);
    };

    private onError = (error: Error) => {
        this.active = false;
        this.retryAfter = Date.now() + 60000;
        const client = this.client;
        this.client = undefined;
        if (client)
            void this.close(client);
        this.console.warn('ONVIF doorbell events unavailable; retrying in one minute.', error);
    };

    private async close(client: OnvifCameraAPI) {
        client.cam.removeListener('event', this.onEvent);
        client.cam.removeListener('eventsError', this.onError);
        if (!client.cam.events?.subscription)
            return;
        try {
            await client.unsubscribe();
        }
        catch {
            // A failed/expired subscription may already be gone on the NVR.
        }
    }

    start(): Promise<void> {
        if (this.pending)
            return this.pending;
        if (this.stopped || this.active || Date.now() < this.retryAfter)
            return Promise.resolve();
        this.pending = this.connect().finally(() => this.pending = undefined);
        return this.pending;
    }

    private async connect() {
        let client: OnvifCameraAPI;
        try {
            client = await connectCameraAPI(this.address, this.username, this.password, this.console, undefined);
            if (this.stopped) {
                await this.close(client);
                return;
            }
            this.client = client;
            // Reolink NVRs can emit Visitor events without listing that topic in
            // GetEventProperties. Attempt the subscription instead of rejecting it.
            await client.createSubscription();
            if (this.stopped) {
                await this.close(client);
                return;
            }
            client.cam.on('eventsError', this.onError);
            this.active = true;
            client.cam.on('event', this.onEvent);
            this.console.log('Listening for ONVIF doorbell events.');
        }
        catch (error) {
            if (this.stopped) {
                if (client)
                    await this.close(client);
                return;
            }
            this.onError(error);
        }
    }

    stop() {
        this.stopped = true;
        this.active = false;
        const client = this.client;
        this.client = undefined;
        if (client)
            void this.close(client);
    }
}
