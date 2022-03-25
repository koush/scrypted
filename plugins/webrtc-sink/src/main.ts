import { Settings, RTCSignalingChannel, ScryptedDeviceType, ScryptedInterface, VideoCamera, Setting, SettingValue, RTCSessionControl, RTCSignalingClientOptions, RTCSignalingSession, FFMpegInput, ScryptedMimeTypes, RTCAVSignalingSetup, Intercom } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { AutoenableMixinProvider } from '@scrypted/common/src/autoenable-mixin-provider';
import { SettingsMixinDeviceBase, SettingsMixinDeviceOptions } from '@scrypted/common/src/settings-mixin';
import { StorageSettings } from '@scrypted/common/src/settings';
import { startRTCPeerConnectionFFmpegInput } from '@scrypted/common/src/ffmpeg-to-wrtc';
import { BrowserSignalingSession, connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';


const { mediaManager, systemManager } = sdk;

const supportedTypes = [
    ScryptedDeviceType.Camera,
    ScryptedDeviceType.Doorbell,
];


function createSetup(type: 'offer' | 'answer', audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): RTCAVSignalingSetup {
    return {
        type,
        audio: {
            direction: audioDirection,
        },
        video: {
            direction: videoDirection,
        },
    }
};

class ScryptedSignalingSession extends BrowserSignalingSession {
    async createPeerConnection(setup: RTCAVSignalingSetup): Promise<void> {
        return super.createPeerConnection(setup);
    }
}

class WebRTCMixin extends SettingsMixinDeviceBase<VideoCamera & RTCSignalingChannel & Intercom> implements RTCSignalingChannel {
    storageSettings = new StorageSettings(this, {

    });

    constructor(options: SettingsMixinDeviceOptions<RTCSignalingChannel & Settings & VideoCamera & Intercom>) {
        super(options)
    }

    async startRTCSignalingSession(session: RTCSignalingSession, options?: RTCSignalingClientOptions): Promise<RTCSessionControl> {
        // if the camera natively has RTCSignalingChannel and the client is not a weird non-browser
        // thing like Alexa, etc, pass through. Otherwise proxy/transcode.
        if (this.mixinDeviceInterfaces.includes(ScryptedInterface.RTCSignalingChannel) && !options?.proxy)
            return this.mixinDevice.startRTCSignalingSession(session, options);

        const device = systemManager.getDeviceById<VideoCamera>(this.id);
        const mo = await device.getVideoStream();
        const ffInput = await mediaManager.convertMediaObjectToJSON<FFMpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
        const pc = await startRTCPeerConnectionFFmpegInput(ffInput, this.console, {
            maxWidth: 960,
        });

        const hasIntercom = this.mixinDeviceInterfaces.includes(ScryptedInterface.Intercom);

        if (hasIntercom) {
            const transceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
            const wrtc = require('@koush/wrtc');
            const { RTCAudioSink } = wrtc.nonstandard;
            const sink = new RTCAudioSink(transceiver.receiver.track);
            sink.addEventListener('data', data => {
                // this.console.log(data);
            });
        }

        const answerSession = new ScryptedSignalingSession(pc);
        answerSession.options = undefined;
        answerSession.hasSetup = true;

        setTimeout(() => {
            pc.onicecandidate({
                candidate: undefined,
            } as any)
        }, 2000);

        const offerAudioDirection = hasIntercom
            ? 'sendrecv'
            : 'recvonly';

        const answerAudioDirection = hasIntercom
            ? 'sendrecv'
            : 'sendonly';

        connectRTCSignalingClients(session, createSetup('offer', offerAudioDirection, 'recvonly'),
            answerSession, createSetup('answer', answerAudioDirection, 'sendonly'), !!options?.offer);

        return undefined;
    }

    getMixinSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putMixinSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }
}

class WebRTCSinkPlugin extends AutoenableMixinProvider {
    constructor() {
        super();
        this.on = this.on || false;
    }
    async canMixin(type: ScryptedDeviceType, interfaces: string[]): Promise<string[]> {
        if (!supportedTypes.includes(type))
            return;

        if (!interfaces.includes(ScryptedInterface.VideoCamera))
            return;

        return [
            '@scrypted/webrtc-sink',
            ScryptedInterface.RTCSignalingChannel,
            ScryptedInterface.Settings,
        ];
    }

    async getMixin(mixinDevice: any, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any; }): Promise<any> {
        return new WebRTCMixin({
            mixinDevice,
            mixinDeviceInterfaces,
            mixinDeviceState,
            group: 'WebRTC',
            groupKey: 'webrtc-sink',
            mixinProviderNativeId: this.nativeId,
        })
    }

    async releaseMixin(id: string, mixinDevice: any): Promise<void> {
        await mixinDevice.release();
    }
}

export default new WebRTCSinkPlugin();
