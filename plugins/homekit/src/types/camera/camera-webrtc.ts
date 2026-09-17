import { Deferred } from '@scrypted/common/src/deferred';
import { createAsyncQueue } from '@scrypted/common/src/async-queue';
import { randomBytes } from 'crypto';
import { parseSdp } from '@scrypted/common/src/sdp-utils';
import type { RTCSessionControl, RTCSignalingChannel, RTCSignalingOptions, RTCSignalingSession } from '@scrypted/sdk';
import type { SecureVideoVideoTier, WebRTCICECandidate, WebRTCStreamingDelegate } from '../../hap';

export function filterHomeKitOfferCodecs(sdp: string) {
    const parsed = parseSdp(sdp);
    // Removing the HEVC-only filter caused remote playback to stop loading.
    // The selected codec in that failed session has not been confirmed.
    for (const section of parsed.msections) {
        if (section.type !== 'video')
            continue;
        const payloadTypes = new Set(section.rtpmaps
            .filter(mapping => mapping.rawCodec?.toLowerCase() === 'h265' && section.payloadTypes.includes(mapping.payloadType))
            .map(mapping => mapping.payloadType));
        if (!payloadTypes.size)
            throw new Error('HomeKit WebRTC offer is missing h265');
        const mline = section.lines[0].split(/\s+/);
        section.lines[0] = [...mline.slice(0, 3), ...mline.slice(3).filter(pt => payloadTypes.has(Number(pt)))].join(' ');
        section.lines = section.lines.filter(line => {
            const attribute = /^a=(?:rtpmap|fmtp|rtcp-fb):(\d+)(?:\s|$)/.exec(line);
            return !attribute || payloadTypes.has(Number(attribute[1]));
        });
    }
    return parsed.toSdp().trimEnd() + '\r\n';
}

export function addHomeKitVideoMetadata(sdp: string, tier: Pick<SecureVideoVideoTier, 'width' | 'height' | 'frameRate' | 'peakBitrate'>) {
    const parsed = parseSdp(sdp);
    const video = parsed.msections.find(section => section.type === 'video');
    if (!video)
        throw new Error('HomeKit WebRTC offer is missing video');

    // Keep the RID advertisement in HAP signaling without configuring a sender
    // encoding: sending the RID RTP extension broke remote playback.
    // Omitting the entire SDP RID line also failed to load remote video.
    if (!video.lines.some(line => /^a=rid:\S+ send(?:\s|$)/.test(line)))
        video.lines.push('a=rid:1 send');
    // Removing these four constraints together broke remote playback, while
    // removing b=AS/b=TIAS did not. Individual constraint requirements remain
    // untested; retain the working set independently of bandwidth/extmap lines.
    const bitrate = tier.peakBitrate * 1000;
    video.lines = video.lines.map(line => {
        const rid = /^(a=rid:\S+ send)(?:\s+(.*))?$/.exec(line);
        if (!rid)
            return line;
        const constraints = (rid[2] || '').split(';').filter(value => value
            && !/^(max-width|max-height|max-fps|max-br)=/.test(value));
        constraints.push(`max-width=${tier.width}`, `max-height=${tier.height}`,
            `max-fps=${tier.frameRate}`, `max-br=${bitrate}`);
        return `${rid[1]} ${constraints.join(';')}`;
    });
    return parsed.toSdp().trimEnd() + '\r\n';
}

// HAP supplies ICE candidates separately; the non-trickle signaling interface
// expects them in the answer's media sections.
export function mergeHomeKitIceCandidates(sdp: string, candidates: WebRTCICECandidate[]) {
    const sections = sdp.replace(/\r\n/g, '\n').trimEnd().split(/\n(?=m=)/);
    const media = sections.slice(1).map(section => section.split('\n'));
    for (const candidate of candidates) {
        if (!candidate.candidate)
            continue;
        const index = candidate.sdpMid !== undefined
            ? media.findIndex(lines => lines.includes(`a=mid:${candidate.sdpMid}`))
            : candidate.sdpMLineIndex ?? (media.length === 1 ? 0 : -1);
        const lines = media[index];
        if (!lines || (candidate.sdpMid !== undefined && candidate.sdpMLineIndex !== undefined
            && candidate.sdpMLineIndex !== index))
            throw new Error('Invalid HomeKit ICE candidate media section');
        if (/[\r\n]/.test(candidate.candidate))
            throw new Error('Invalid HomeKit ICE candidate');
        const line = candidate.candidate.startsWith('a=') ? candidate.candidate : `a=${candidate.candidate}`;
        if (!lines.includes(line)) {
            const end = lines.indexOf('a=end-of-candidates');
            lines.splice(end < 0 ? lines.length : end, 0, line);
        }
    }
    return [sections[0], ...media.map(lines => lines.join('\n'))].join('\n').replace(/\n/g, '\r\n') + '\r\n';
}

class HomeKitSignalingSession implements RTCSignalingSession {
    options: RTCSignalingOptions = {
        // The WebRTC plugin interprets this as generating the offer for us.
        requiresAnswer: true,
        disableTrickle: true,
        proxy: true,
        userAgent: 'HomeKit iOS',
    };
    __proxy_props = { options: this.options };
    offer = new Deferred<string>();
    answer = new Deferred<RTCSessionDescriptionInit>();

    constructor(sframeEnabled: boolean) {
        this.options.sframe = {
            profile: 'homekit',
            sendKey: sframeEnabled ? {
                kid: randomBytes(8).readBigUInt64BE().toString(),
                key: randomBytes(32).toString('base64'),
            } : undefined,
        };
        // Either side may be cancelled before the signaling peer starts waiting.
        this.offer.promise.catch(() => { });
        this.answer.promise.catch(() => { });
    }

    async getOptions() {
        return this.options;
    }

    async setRemoteDescription(description: RTCSessionDescriptionInit) {
        if (description.type !== 'offer' || !description.sdp || this.offer.finished)
            throw new Error('Unexpected HomeKit WebRTC offer');
        this.offer.resolve(description.sdp);
    }

    async createLocalDescription(type: 'offer' | 'answer') {
        if (type !== 'answer')
            throw new Error('HomeKit WebRTC requires an accessory offer');
        return this.answer.promise;
    }

    async addIceCandidate() {
        throw new Error('HomeKit WebRTC requires non-trickle ICE');
    }
}

export function createHomeKitWebRTCDelegate(camera: RTCSignalingChannel, console: Console,
    tier: Parameters<typeof addHomeKitVideoMetadata>[1]) {
    type ReceiveKeyUpdate = Parameters<NonNullable<RTCSessionControl['updateSFrameReceiveKeys']>>[0];
    const sessions = new Map<string, {
        signaling: HomeKitSignalingSession;
        control?: RTCSessionControl;
        receiveKeys: ReturnType<typeof createAsyncQueue<ReceiveKeyUpdate>>;
        timer: ReturnType<typeof setTimeout>;
    }>();

    const end = async (id: string) => {
        const session = sessions.get(id);
        if (!session)
            return;
        sessions.delete(id);
        clearTimeout(session.timer);
        session.receiveKeys.clear();
        session.receiveKeys.end();
        const error = new Error('HomeKit WebRTC session ended');
        session.signaling.offer.reject(error);
        session.signaling.answer.reject(error);
        try {
            await session.control?.endSession();
        }
        finally {
            await delegate.onSessionEnded?.(id);
        }
        console.log('HSV3 WebRTC ended');
    };

    const delegate: WebRTCStreamingDelegate & { stopAll(): void; onSessionEnded?: (id: string) => Promise<void> } = {
        async handleSolicitOffer(request) {
            if (sessions.has(request.sessionIdentifier) || sessions.size >= 16)
                throw new Error('HomeKit WebRTC session unavailable');
            // Empty Solicit Offer options decode as sframeEnabled=false. Honoring
            // that value and omitting the sender key failed to load remote video;
            // always enable SFrame for this HomeKit path.
            const signaling = new HomeKitSignalingSession(true);
            const id = request.sessionIdentifier;
            const session = {
                signaling,
                control: undefined as RTCSessionControl | undefined,
                receiveKeys: createAsyncQueue<ReceiveKeyUpdate>(),
                timer: setTimeout(() => {
                    console.log('HSV3 WebRTC negotiation timed out');
                    end(id).catch(() => console.log('HSV3 WebRTC cleanup failed'));
                }, 60000),
            };
            session.timer.unref();
            sessions.set(id, session);
            console.log('HSV3 WebRTC soliciting offer; SFrame requested:', request.options.sframeEnabled);
            console.log('HSV3 WebRTC send key prepared:', !!signaling.options.sframe.sendKey);
            // The channel returns a control before negotiation completes. Do not
            // await it here: other implementations may wait for Apple's answer.
            (async () => {
                try {
                    const control = await camera.startRTCSignalingSession(signaling);
                    await control.setPlayback({
                        audio: 'on-demand',
                        video: false,
                    });
                    if (sessions.get(id) !== session) {
                        await control?.endSession();
                        return;
                    }
                    session.control = control;
                    for await (const update of session.receiveKeys.queue) {
                        if (sessions.get(id) !== session)
                            break;
                        await control?.updateSFrameReceiveKeys?.(update);
                    }
                }
                catch {
                    console.log('HSV3 WebRTC signaling failed');
                    if (sessions.get(id) === session) {
                        try {
                            await end(id);
                        }
                        catch {
                            console.log('HSV3 WebRTC cleanup failed');
                        }
                    }
                }
            })();
            let sdpOffer: string;
            try {
                sdpOffer = addHomeKitVideoMetadata(filterHomeKitOfferCodecs(await signaling.offer.promise), tier);
            }
            catch (error) {
                await end(id);
                throw error;
            }
            console.log('HSV3 WebRTC offer ready');
            // This is the final HAP offer, after codec filtering and tier metadata.
            console.log('[HSV3 SDP]', JSON.stringify({ type: 'offer', sessionIdentifier: id, sdp: sdpOffer }));
            const sendKey = signaling.options.sframe.sendKey;
            return {
                sdpOffer,
                sframe: sendKey ? { kid: BigInt(sendKey.kid), key: Buffer.from(sendKey.key, 'base64') } : undefined,
            };
        },
        async handleProvideAnswer(request) {
            const session = sessions.get(request.sessionIdentifier);
            if (!session || !session.signaling.offer.finished || session.signaling.answer.finished)
                throw new Error('Unexpected HomeKit WebRTC answer');
            if (!request.sdpAnswer)
                throw new Error('Missing HomeKit WebRTC answer');
            const sdp = mergeHomeKitIceCandidates(request.sdpAnswer, request.candidates || []);
            console.log('[HSV3 SDP]', JSON.stringify({
                type: 'answer', sessionIdentifier: request.sessionIdentifier,
                sdp: request.sdpAnswer, candidates: request.candidates || []
            }));
            session.signaling.answer.resolve({ type: 'answer', sdp });
            clearTimeout(session.timer);
            console.log('HSV3 WebRTC answer forwarded');
        },
        async handleReoffer(request) {
            console.warn(request);
            const session = sessions.get(request.sessionIdentifier);
            await session.control!.setRemoteDescription({
                type: 'offer',
                sdp: request.sdpOffer,
            }, );
            const response = await session.control.createLocalDescription('answer');
            session.control.setPlayback({
                audio: 'on-demand',
                video: false,
            });
            return {
                sdpAnswer: response.sdp,
            }
        },
        async handleUpdateSession(update) {
            const session = sessions.get(update.sessionIdentifier);
            if (!session)
                throw new Error('Unknown HomeKit WebRTC session');
            session.receiveKeys.submit({
                add: update.receiveKeysToAdd.map(({ kid, key }) => ({
                    kid: kid.toString(), key: Buffer.from(key).toString('base64'),
                })),
                remove: update.receiveKIDsToRemove.map(kid => kid.toString()),
            });
            console.log('HSV3 WebRTC receive keys queued; added:', update.receiveKeysToAdd.length,
                'removed:', update.receiveKIDsToRemove.length);
        },
        async handleEndSession(sessionIdentifier) {
            await end(sessionIdentifier);
        },
        stopAll() {
            for (const id of sessions.keys())
                end(id).catch(() => console.log('HSV3 WebRTC cleanup failed'));
        },
    };
    return delegate;
}
