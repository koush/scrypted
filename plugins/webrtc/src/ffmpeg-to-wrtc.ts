import { MediaStreamTrack, RTCPeerConnection, RTCRtpTransceiver, RtpPacket } from "@koush/werift";

import { Deferred } from "@scrypted/common/src/deferred";
import sdk, { BufferConverter, BufferConvertorOptions, FFmpegInput, FFmpegTranscodeStream, Intercom, MediaObject, MediaStreamDestination, RequestMediaStream, RTCAVSignalingSetup, RTCConnectionManagement, RTCMediaObjectTrack, RTCSignalingOptions, RTCSignalingSession, ScryptedDevice, ScryptedDeviceBase, ScryptedInterface, ScryptedMimeTypes } from "@scrypted/sdk";
import type { WebRTCPlugin } from "./main";
import { ScryptedSessionControl } from "./session-control";
import { requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { logIsPrivateIceTransport } from "./werift-util";

import { addVideoFilterArguments } from "@scrypted/common/src/ffmpeg-helpers";
import { connectRTCSignalingClients } from "@scrypted/common/src/rtc-signaling";
import { getSpsPps } from "@scrypted/common/src/sdp-utils";
import { H264Repacketizer } from "../../homekit/src/types/camera/h264-packetizer";
import { turnServer } from "./ice-servers";
import { waitConnected } from "./peerconnection-util";
import { RtpTrack, RtpTracks, startRtpForwarderProcess } from "./rtp-forwarders";
import { getAudioCodec, getFFmpegRtpAudioOutputArguments } from "./webrtc-required-codecs";
import { WeriftSignalingSession } from "./werift-signaling-session";

function getDebugModeH264EncoderArgs() {
    return [
        '-profile:v', 'baseline',
        // ultrafast seems to have the lowest latency but forces constrained baseline
        // so the prior argument is redundant. It actualy seems like decoding non-baseline
        // on mac, at least, causes inherent latency which can't be flushed from upstream.
        '-preset', 'ultrafast',
        '-g', '60',
        "-c:v", "libx264",
        "-bf", "0",
        // "-tune", "zerolatency",
    ];
}

function createSetup(audioDirection: RTCRtpTransceiverDirection, videoDirection: RTCRtpTransceiverDirection): Partial<RTCAVSignalingSetup> {
    return {
        configuration: {
            iceServers: [
                turnServer,
            ],
        },
        audio: {
            direction: audioDirection,
        },
        video: {
            direction: videoDirection,
        },
    }
};

export async function createTrackForwarder(timeStart: number, isPrivate: boolean,
    requestMediaStream: RequestMediaStream,
    videoTransceiver: RTCRtpTransceiver, audioTransceiver: RTCRtpTransceiver,
    sessionSupportsH264High: boolean, maximumCompatibilityMode: boolean, transcodeWidth: number) {
    const transcodeBaseline = !sessionSupportsH264High || maximumCompatibilityMode;
    if (transcodeBaseline) {
        console.log('Requesting medium-resolution stream', {
            sessionSupportsH264High,
            maximumCompatibilityMode,
        });
    }
    const requestDestination: MediaStreamDestination = transcodeBaseline ? 'medium-resolution' : 'local';
    const mo = await requestMediaStream({
        video: {
            codec: 'h264',
        },
        audio: {
            codec: 'opus',
        },
        destination: isPrivate ? requestDestination : 'remote',
        tool: transcodeBaseline ? 'ffmpeg' : 'scrypted',
    });
    const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
    const { mediaStreamOptions } = ffmpegInput;

    if (!maximumCompatibilityMode) {
        if (mediaStreamOptions.audio?.codec === 'pcm_ulaw') {
            audioTransceiver.sender.codec = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMU')
        }
        else if (mediaStreamOptions.audio?.codec === 'pcm_alaw') {
            audioTransceiver.sender.codec = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMA')
        }
    }

    const { name: audioCodecName } = getAudioCodec(audioTransceiver.sender.codec);
    let audioCodecCopy = maximumCompatibilityMode ? undefined : audioCodecName;

    const videoTranscodeArguments: string[] = [];
    const transcode = transcodeBaseline
        || mediaStreamOptions?.video?.codec !== 'h264'
        || ffmpegInput.h264EncoderArguments?.length
        || ffmpegInput.h264FilterArguments?.length;

    let videoCodecCopy = transcode ? undefined : 'h264';

    if (ffmpegInput.mediaStreamOptions?.oobCodecParameters)
        videoTranscodeArguments.push("-bsf:v", "dump_extra");
    videoTranscodeArguments.push(...(ffmpegInput.h264FilterArguments || []));

    if (transcode) {
        const conservativeDefaultBitrate = isPrivate ? 1000000 : 500000;
        const bitrate = maximumCompatibilityMode ? conservativeDefaultBitrate : (ffmpegInput.destinationVideoBitrate || conservativeDefaultBitrate);
        videoTranscodeArguments.push(
            // this seems to cause issues with presets i think.
            // '-level:v', '4.0',
            "-b:v", bitrate.toString(),
            "-bufsize", (2 * bitrate).toString(),
            "-maxrate", bitrate.toString(),
            '-r', '15',
        );

        const scaleFilter = `scale='min(${transcodeWidth},iw)':-2`;
        addVideoFilterArguments(videoTranscodeArguments, scaleFilter);

        if (transcodeBaseline) {
            // baseline profile must use libx264, not sure other encoders properly support it.
            videoTranscodeArguments.push(

                ...getDebugModeH264EncoderArgs(),
            );

            // unable to find conditions to make this working properly.
            // encoding results in chop if bitrate is not sufficient.
            // this may need to be aligned with h264 level?
            // or no bitrate hint?
            // videoArgs.push('-tune', 'zerolatency');
        }
        else {
            videoTranscodeArguments.push(...(ffmpegInput.h264EncoderArguments || getDebugModeH264EncoderArgs()));
        }
    }
    else {
        videoTranscodeArguments.push('-vcodec', 'copy')
    }

    const audioTranscodeArguments = getFFmpegRtpAudioOutputArguments(ffmpegInput.mediaStreamOptions?.audio?.codec, audioTransceiver.sender.codec, maximumCompatibilityMode);

    let needPacketization = !transcode;
    if (transcode) {
        try {
            const transcodeStream: FFmpegTranscodeStream = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.FFmpegTranscodeStream);
            await transcodeStream({
                videoDecoderArguments: ffmpegInput.videoDecoderArguments,
                videoTranscodeArguments,
                audioTranscodeArguments,
            });
            videoTranscodeArguments.splice(0, videoTranscodeArguments.length);
            videoCodecCopy = 'copy';
            audioCodecCopy = 'copy';
            needPacketization = true;
        }
        catch (e) {
        }
    }

    const audioRtpTrack: RtpTrack = {
        codecCopy: audioCodecCopy,
        onRtp: buffer => audioTransceiver.sender.sendRtp(buffer),
        encoderArguments: [
            ...audioTranscodeArguments,
        ]
    };

    const videoPacketSize = 1300;
    let h264Repacketizer: H264Repacketizer;
    let spsPps: ReturnType<typeof getSpsPps>;

    const videoRtpTrack: RtpTrack = {
        codecCopy: videoCodecCopy,
        packetSize: videoPacketSize,
        onMSection: (videoSection) => spsPps = getSpsPps(videoSection),
        onRtp: (buffer) => {
            if (needPacketization) {
                if (!h264Repacketizer) {
                    h264Repacketizer = new H264Repacketizer(console, videoPacketSize, {
                        ...spsPps,
                    });
                }
                const repacketized = h264Repacketizer.repacketize(RtpPacket.deSerialize(buffer));
                for (const packet of repacketized) {
                    videoTransceiver.sender.sendRtp(packet);
                }
            }
            else {
                videoTransceiver.sender.sendRtp(buffer);
            }
        },
        encoderArguments: [
            ...videoTranscodeArguments,
        ],
        firstPacket: () => console.log('first video packet', Date.now() - timeStart),
    };

    let tracks: RtpTracks;
    if (ffmpegInput.mediaStreamOptions?.audio === null) {
        tracks = {
            video: videoRtpTrack,
        }
    }
    else {
        tracks = {
            video: videoRtpTrack,
            audio: audioRtpTrack,
        }
    }

    return startRtpForwarderProcess(console, ffmpegInput, tracks);
}

export function parseOptions(options: RTCSignalingOptions) {
    // should really inspect the session description here.
    // we assume that the camera doesn't output h264 baseline, because
    // that is awful quality. so check to see if the session has an
    // explicit list of supported codecs with a passable h264 high on it.
    let sessionSupportsH264High = !!options?.capabilities?.video?.codecs
        ?.filter(codec => codec.mimeType.toLowerCase() === 'video/h264')
        // 42 is baseline profile
        // 64001f (chrome) or 640c1f (safari) is high profile.
        // firefox only advertises 42e01f.
        // nest hub max offers high 640015. this means the level (hex 15) is 2.1,
        // this corresponds to a resolution of 480p according to the spec?
        // https://en.wikipedia.org/wiki/Advanced_Video_Coding#Levels
        // however, the 640x1f indicates a max resolution of 720p, but
        // desktop browsers can handle 1080p+ fine regardless, since it does
        // not actually seem to confirm the level. the level is merely a hint
        // to make a rough guess as to the decoding capability of the client.
        ?.find(codec => {
            let sdpFmtpLine = codec.sdpFmtpLine.toLowerCase();
            return sdpFmtpLine.includes('profile-level-id=64001f')
                || sdpFmtpLine.includes('profile-level-id=640c1f');
        });
    const transcodeWidth = Math.max(640, Math.min(options?.screen?.width || 960, 1280));

    // firefox is misleading. special case that to disable transcoding.
    if (options?.userAgent?.includes('Firefox/'))
        sessionSupportsH264High = true;

    return {
        sessionSupportsH264High,
        transcodeWidth,
    };
}

class WebRTCTrack implements RTCMediaObjectTrack {
    control: ScryptedSessionControl;
    removed = new Deferred<void>();

    constructor(public connectionManagement: WebRTCConnectionManagement, public video: RTCRtpTransceiver, public audio: RTCRtpTransceiver, public intercom: Intercom) {
        this.control = new ScryptedSessionControl(async () => { }, intercom, audio);
    }

    async replace(mediaObject: MediaObject): Promise<void> {
        throw new Error("Method not implemented.");
        const { atrack, vtrack, createTrackForwarder, intercom } = await this.connectionManagement.createTracks(mediaObject);

        this.video.sender.replaceTrack(vtrack);
        this.audio.sender.replaceTrack(atrack);
    }

    cleanup(cleanupTrackOnly: boolean) {
        if (this.removed.finished)
            return;
        this.removed.resolve(undefined);
        this.control.cleanup();

        if (cleanupTrackOnly)
            return;

        this.connectionManagement.activeTracks.delete(this);
        this.connectionManagement.pc.removeTrack(this.video.sender);
        this.connectionManagement.pc.removeTrack(this.audio.sender);
    }

    async remove(): Promise<void> {
        return this.cleanup(false);
    }

    setPlayback(options: { audio: boolean; video: boolean; }): Promise<void> {
        return this.control.setPlayback(options);
    }
}

export class WebRTCConnectionManagement implements RTCConnectionManagement {
    pc: RTCPeerConnection;
    private negotiationDeferred = new Deferred<void>();
    weriftSignalingSession: WeriftSignalingSession;
    activeTracks = new Set<WebRTCTrack>();
    closed = false;

    constructor(public console: Console, public clientSession: RTCSignalingSession, public maximumCompatibilityMode: boolean, public transcodeWidth: number,
        public sessionSupportsH264High: boolean,
        public options?: {
            disableIntercom?: boolean,
        }) {

        this.pc = new RTCPeerConnection({
            // werift supports ice servers, but it seems to fail for some reason.
            // it does not matter, as we can send the ice servers to the browser instead.
            // the cameras and alexa targets will also provide externally reachable addresses.
            codecs: {
                audio: [
                    ...requiredAudioCodecs,
                ],
                video: [
                    requiredVideoCodec,
                ],
            }
        });

        this.weriftSignalingSession = new WeriftSignalingSession(console, this.pc);
    }

    async createTracks(mediaObject: MediaObject) {
        let requestMediaStream: RequestMediaStream;

        try {
            requestMediaStream = await sdk.mediaManager.convertMediaObject(mediaObject, ScryptedMimeTypes.RequestMediaStream);
        }
        catch (e) {
            requestMediaStream = async () => mediaObject;
        }

        let intercom: Intercom;
        try {
            const device = await sdk.mediaManager.convertMediaObject<ScryptedDevice & Intercom>(mediaObject, ScryptedMimeTypes.ScryptedDevice);
            if (device.interfaces.includes(ScryptedInterface.Intercom))
                intercom = device;
        }
        catch (e) {
        }

        const vtrack = new MediaStreamTrack({
            kind: "video", codec: requiredVideoCodec,
        });

        const atrack = new MediaStreamTrack({ kind: "audio" });

        const timeStart = Date.now();
        return {
            vtrack,
            atrack,
            intercom,
            createTrackForwarder: (videoTransceiver: RTCRtpTransceiver, audioTransceiver: RTCRtpTransceiver) =>
                createTrackForwarder(timeStart, logIsPrivateIceTransport(this.console, this.pc), requestMediaStream,
                    videoTransceiver, audioTransceiver,
                    this.sessionSupportsH264High, this.maximumCompatibilityMode, this.transcodeWidth),
        }
    }

    get negotiation() {
        if (this.negotiationDeferred.finished)
            this.negotiationDeferred = new Deferred();
        return this.negotiationDeferred.promise;
    }

    async negotiateRTCSignalingSession(): Promise<void> {
        try {
            await connectRTCSignalingClients(this.console,
                this.weriftSignalingSession, createSetup(this.options?.disableIntercom ? 'sendonly' : 'sendrecv', 'sendonly'),
                this.clientSession, createSetup(this.options?.disableIntercom ? 'recvonly' : 'sendrecv', 'recvonly'),
            );
            this.negotiationDeferred.resolve(undefined);
        }
        catch (e) {
            this.negotiationDeferred.reject(e);
        }
    }

    async addTrack(mediaObject: MediaObject, options?: {
        videoMid?: string,
        audioMid?: string,
    }) {
        const { atrack, vtrack, createTrackForwarder, intercom } = await this.createTracks(mediaObject);

        const videoTransceiver = this.pc.addTransceiver(vtrack, {
            direction: 'sendonly',
        });
        videoTransceiver.mid = options?.videoMid;

        const audioTransceiver = this.pc.addTransceiver(atrack, {
            direction: this.options?.disableIntercom ? 'sendonly' : 'sendrecv',
        });
        audioTransceiver.mid = options?.audioMid;

        const ret = new WebRTCTrack(this, videoTransceiver, audioTransceiver, this.options?.disableIntercom ? undefined : intercom);

        this.negotiation.then(async () => {
            if (ret.removed.finished)
                return;
            await waitConnected(this.pc);
            const f = await createTrackForwarder(videoTransceiver, audioTransceiver);
            ret.removed.promise.finally(() => f.kill());
        });

        return ret;
    }

    async close(): Promise<void> {
        for (const track of this.activeTracks) {
            track.remove();
        }
        this.activeTracks.clear();
        this.pc.close();
    }
}

export class WebRTCBridge extends ScryptedDeviceBase implements BufferConverter {
    constructor(public plugin: WebRTCPlugin, nativeId: string) {
        super(nativeId);

        this.fromMimeType = ScryptedMimeTypes.RTCSignalingSession;
        this.toMimeType = ScryptedMimeTypes.RTCConnectionManagement;
    }

    async convert(data: any, fromMimeType: string, toMimeType: string, options?: BufferConvertorOptions): Promise<any> {
        const session = data as RTCSignalingSession;
        const maximumCompatibilityMode = !!this.plugin.storageSettings.values.maximumCompatibilityMode;
        const { transcodeWidth, sessionSupportsH264High } = parseOptions(await session.getOptions());

        return new WebRTCConnectionManagement(this.console, session, maximumCompatibilityMode, transcodeWidth, sessionSupportsH264High);
    }
}

export async function createRTCPeerConnectionSink(
    clientSignalingSession: RTCSignalingSession,
    console: Console,
    disableIntercom: boolean,
    mo: MediaObject,
    maximumCompatibilityMode: boolean,
) {
    const { transcodeWidth, sessionSupportsH264High } = parseOptions(await clientSignalingSession.getOptions());
    
    const connection = new WebRTCConnectionManagement(console, clientSignalingSession, maximumCompatibilityMode, transcodeWidth, sessionSupportsH264High, {
        disableIntercom,
    });

    const track = await connection.addTrack(mo);

    track.control.cleanup = async () => {
        track.cleanup(true);
        connection.pc.close();
    }

    connection.negotiateRTCSignalingSession();

    return track.control;
}
