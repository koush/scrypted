import { MediaStreamTrack, PeerConfig, RTCPeerConnection, RTCRtpCodecParameters, RTCRtpTransceiver, RtpPacket } from "./werift";

import { Deferred } from "@scrypted/common/src/deferred";
import sdk, { FFmpegInput, FFmpegTranscodeStream, Intercom, MediaObject, MediaStreamDestination, MediaStreamFeedback, RequestMediaStream, RTCAVSignalingSetup, RTCConnectionManagement, RTCMediaObjectTrack, RTCSignalingOptions, RTCSignalingSession, ScryptedDevice, ScryptedMimeTypes } from "@scrypted/sdk";
import { ScryptedSessionControl } from "./session-control";
import { requiredAudioCodecs, requiredVideoCodec } from "./webrtc-required-codecs";
import { isLocalIceTransport, logIsLocalIceTransport } from "./werift-util";

import { addVideoFilterArguments } from "@scrypted/common/src/ffmpeg-helpers";
import { connectRTCSignalingClients, legacyGetSignalingSessionOptions } from "@scrypted/common/src/rtc-signaling";
import { getSpsPps } from "@scrypted/common/src/sdp-utils";
import { H264Repacketizer } from "../../homekit/src/types/camera/h264-packetizer";
import { logConnectionState, waitClosed, waitConnected, waitIceConnected } from "./peerconnection-util";
import { RtpCodecCopy, RtpTrack, RtpTracks, startRtpForwarderProcess } from "./rtp-forwarders";
import { getAudioCodec, getFFmpegRtpAudioOutputArguments } from "./webrtc-required-codecs";
import { WeriftSignalingSession } from "./werift-signaling-session";

export const RTC_BRIDGE_NATIVE_ID = 'rtc-bridge';

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

const fullResolutionAllowList = [
    'Windows',
    'Macintosh',
    'iPhone',
    'iPad',
    'iOS',
];

export async function createTrackForwarder(options: {
    timeStart: number,
    isLocalNetwork: boolean, destinationId: string, ipv4: boolean,
    requestMediaStream: RequestMediaStream,
    videoTransceiver: RTCRtpTransceiver, audioTransceiver: RTCRtpTransceiver,
    maximumCompatibilityMode: boolean, clientOptions: RTCSignalingOptions,
}) {
    const {
        timeStart,
        isLocalNetwork, destinationId,
        requestMediaStream,
        videoTransceiver, audioTransceiver,
        maximumCompatibilityMode,
        clientOptions,
    } = options;

    const { sessionSupportsH264High, transcodeWidth, isMediumResolution, width, height } = parseOptions(clientOptions);

    let transcodeBaseline = maximumCompatibilityMode;
    // const transcodeBaseline = !sessionSupportsH264High || maximumCompatibilityMode;
    const handlesHighResolution = !isMediumResolution && !transcodeBaseline;

    let requestDestination: MediaStreamDestination;
    if (transcodeBaseline) {
        requestDestination = 'medium-resolution';
    }
    else if (!isLocalNetwork) {
        requestDestination = 'remote';
    }

    const mo = await requestMediaStream({
        video: {
            codec: 'h264',
            width,
            height,
        },
        audio: {
            codec: 'opus',
        },
        adaptive: handlesHighResolution,
        destination: requestDestination,
        destinationId,
        tool: !handlesHighResolution ? 'ffmpeg' : 'scrypted',
    });

    if (!mo)
        return;

    let mediaStreamFeedback: MediaStreamFeedback;
    try {
        mediaStreamFeedback = await sdk.mediaManager.convertMediaObject(mo, ScryptedMimeTypes.MediaStreamFeedback);
    }
    catch (e) {
    }
    if (mediaStreamFeedback) {
        videoTransceiver.sender.onRtcp.subscribe(rtcp => {
            mediaStreamFeedback.onRtcp(rtcp.serialize());
        });
    }

    const console = sdk.deviceManager.getMixinConsole(mo.sourceId, RTC_BRIDGE_NATIVE_ID);
    const ffmpegInput = await sdk.mediaManager.convertMediaObjectToJSON<FFmpegInput>(mo, ScryptedMimeTypes.FFmpegInput);
    const { mediaStreamOptions } = ffmpegInput;

    // this transcode fallback is for low power devices like the echo show that
    // will crap out if fed a high resolution stream.
    if (isMediumResolution && !transcodeBaseline) {
        // don't transcode on cheapo windows laptops with tiny screens
        // which are capable of handling high resolution streams.
        // this transcode fallback should only be used on Linux devices.
        // But it may not report itself as Linux, so do a non-Windows/Mac/iOS check.
        let found = false;
        for (const allow of fullResolutionAllowList) {
            found ||= options?.clientOptions?.userAgent?.includes(allow);
        }
        if (!found) {
            const width = ffmpegInput?.mediaStreamOptions?.video?.width;
            transcodeBaseline = !width || width > 1280;
        }
    }

    console.log('Client Stream Profile', {
        transcodeBaseline,
        sessionSupportsH264High,
        maximumCompatibilityMode,
        ...clientOptions,
    });

    if (!maximumCompatibilityMode) {
        let found: RTCRtpCodecParameters;
        if (mediaStreamOptions?.audio?.codec === 'pcm_ulaw') {
            found = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMU')
        }
        else if (mediaStreamOptions?.audio?.codec === 'pcm_alaw') {
            found = audioTransceiver.codecs.find(codec => codec.mimeType === 'audio/PCMA')
        }
        if (found)
            audioTransceiver.sender.codec = found;
    }

    const { name: audioCodecName } = getAudioCodec(audioTransceiver.sender.codec);
    let audioCodecCopy = maximumCompatibilityMode ? undefined : audioCodecName;

    const videoTranscodeArguments: string[] = [];
    const transcode = transcodeBaseline
        || mediaStreamOptions?.video?.codec !== 'h264'
        || ffmpegInput.h264EncoderArguments?.length
        || ffmpegInput.h264FilterArguments?.length;

    // let videoCodecCopy: RtpCodecCopy = transcode ? undefined : 'h264';
    const compatibleH264 = !mediaStreamOptions?.video?.h264Info?.reserved30 && !mediaStreamOptions?.video?.h264Info?.reserved31;
    let videoCodecCopy: RtpCodecCopy;
    if (!transcode && compatibleH264)
        videoCodecCopy = 'h264';

    if (ffmpegInput.mediaStreamOptions?.oobCodecParameters)
        videoTranscodeArguments.push("-bsf:v", "dump_extra");
    videoTranscodeArguments.push(...(ffmpegInput.h264FilterArguments || []));

    if (transcode) {
        const conservativeDefaultBitrate = isLocalNetwork ? 1000000 : 500000;
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

    let needPacketization = !!videoCodecCopy;
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
            // is this really necessary?
            needPacketization = true;
        }
        catch (e) {
        }
    }

    const audioRtpTrack: RtpTrack = {
        codecCopy: audioCodecCopy,
        onRtp: audioTransceiver.sender.sendRtp.bind(audioTransceiver.sender),
        encoderArguments: [
            ...audioTranscodeArguments,
        ],
        firstPacket: rtp => {
            const packet = RtpPacket.deSerialize(rtp);
            audioTransceiver.sender.replaceRTP(packet.header, true);
        },
    };

    // ipv4 mtu is 1500
    // so max usable packet size is 1500 - tcp header - ip header
    // 1500 - 20 - 20 = 1460.
    // but set to 1440 just to be safe.
    // 1/9/2023: bug report from eweber discovered that usable MTU on tmobile is 1424.
    // additional consideration should be given whether to always enforce ipv6 mtu on
    // non-local destination?
    // const videoPacketSize = options.ipv4 ? 1424 : 1300;
    // 1/9/2023:
    // 1378 is what homekit requests, regardless of local or remote network.
    // so setting 1378 as the fixed value seems wise, given apple probably has
    // better knowledge of network capabilities, and also mirrors 
    // from my cursory research into ipv6, the MTU is no lesser than ipv4, in fact
    // the min mtu is larger.
    const videoPacketSize = 1378;
    let h264Repacketizer: H264Repacketizer;
    let spsPps: ReturnType<typeof getSpsPps>;

    const videoRtpTrack: RtpTrack = {
        codecCopy: videoCodecCopy,
        packetSize: videoPacketSize,
        onMSection: (videoSection) => spsPps = getSpsPps(videoSection),
        onRtp: (buffer) => {
            let onRtp: (rtp: Buffer) => void;

            if (needPacketization) {
                if (!h264Repacketizer) {
                    // adjust packet size for the rtp packet header (12).
                    h264Repacketizer = new H264Repacketizer(console, videoPacketSize - 12, {
                        ...spsPps,
                    });
                }
                onRtp = buffer => {
                    const repacketized = h264Repacketizer.repacketize(RtpPacket.deSerialize(buffer));
                    for (const packet of repacketized) {
                        videoTransceiver.sender.sendRtp(packet);
                    }
                };
            }
            else {
                onRtp = buffer => {
                    videoTransceiver.sender.sendRtp(buffer);
                };
            }

            videoRtpTrack.onRtp = onRtp;
            videoRtpTrack.onRtp(buffer);
        },
        encoderArguments: [
            ...videoTranscodeArguments,
        ],
        firstPacket: rtp => {
            console.log('first video packet', Date.now() - timeStart);
            const packet = RtpPacket.deSerialize(rtp);
            videoTransceiver.sender.replaceRTP(packet.header, true);
        },
    };

    let tracks: RtpTracks;
    if (ffmpegInput.mediaStreamOptions?.audio === null || !audioTransceiver) {
        tracks = {
            video: videoRtpTrack,
        }
    }
    else if (ffmpegInput.mediaStreamOptions?.video === null || !videoTransceiver) {
        tracks = {
            audio: audioRtpTrack,
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

// https://en.wikipedia.org/wiki/Advanced_Video_Coding#Profiles
const highProfiles = [
    100,
    110,
    122,
    244,
];
const highProfilesHex = highProfiles.map(p => p.toString(16));

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
            for (const hex of highProfilesHex) {
                if (sdpFmtpLine.includes(`profile-level-id=${hex}`))
                    return true;
            }
            return false;
        });


    // firefox is misleading. special case that to disable transcoding.
    if (options?.userAgent?.includes('Firefox/'))
        sessionSupportsH264High = true;

    const transcodeWidth = Math.max(640, Math.min(options?.screen?.width || 960, 1280));
    const devicePixelRatio = options?.screen?.devicePixelRatio || 1;
    const width = (options?.screen?.width * devicePixelRatio) || undefined;
    const height = (options?.screen?.height * devicePixelRatio) || undefined;
    const max = Math.max(width, height);
    const isMediumResolution = !sessionSupportsH264High || (max && max < 1920);

    return {
        sessionSupportsH264High,
        transcodeWidth,
        isMediumResolution,
        width: isMediumResolution ? 1280 : width,
        height: isMediumResolution ? 720 : height,
    };
}

class WebRTCTrack implements RTCMediaObjectTrack {
    control: ScryptedSessionControl;
    removed = new Deferred<void>();

    constructor(public connectionManagement: WebRTCConnectionManagement, public video: RTCRtpTransceiver, public audio: RTCRtpTransceiver, intercom: Intercom) {
        this.control = new ScryptedSessionControl(intercom, audio);
    }

    async onStop(): Promise<void> {
        return this.removed.promise;
    }

    attachForwarder(f: Awaited<ReturnType<typeof createTrackForwarder>>) {
        const stopped = this.removed;
        f.killPromise.then(() => stopped.resolve(undefined)).catch(e => stopped.reject(e));
    }

    async replace(mediaObject: MediaObject): Promise<void> {
        const { createTrackForwarder, intercom } = await this.connectionManagement.createTracks(mediaObject);

        this.cleanup(true);

        this.removed = new Deferred();
        this.control = new ScryptedSessionControl(intercom, this.audio);

        const f = await createTrackForwarder(this.video, this.audio);
        this.attachForwarder(f);
        waitClosed(this.connectionManagement.pc).finally(() => f.kill());
        this.removed.promise.finally(() => f.kill());
    }

    cleanup(cleanupTrackOnly: boolean) {
        if (this.removed.finished)
            return;
        this.removed.resolve(undefined);
        this.control.killed.resolve(undefined);
        this.video.sender.onRtcp.allUnsubscribe();

        if (cleanupTrackOnly)
            return;

        this.connectionManagement.activeTracks.delete(this);
        this.video.stop();
        this.audio.stop();
        this.connectionManagement.pc.removeTrack(this.video.sender);
        this.connectionManagement.pc.removeTrack(this.audio.sender);
    }

    async stop(): Promise<void> {
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

    constructor(public console: Console, public clientSession: RTCSignalingSession,
        public maximumCompatibilityMode: boolean,
        public clientOptions: RTCSignalingOptions,
        public options: {
            configuration: RTCConfiguration,
            weriftConfiguration: Partial<PeerConfig>,
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
            },
            ...options.weriftConfiguration,
        });
        logConnectionState(console, this.pc);
        waitConnected(this.pc)
            .then(() => logIsLocalIceTransport(this.console, this.pc)).catch(() => { });

        this.weriftSignalingSession = new WeriftSignalingSession(console, this.pc);
    }

    async probe() {
    }

    async createTracks(mediaObject: MediaObject, intercomId?: string) {
        let requestMediaStream: RequestMediaStream;

        try {
            requestMediaStream = await sdk.mediaManager.convertMediaObject(mediaObject, ScryptedMimeTypes.RequestMediaStream);
        }
        catch (e) {
            requestMediaStream = async () => mediaObject;
        }

        const intercom = sdk.systemManager.getDeviceById<Intercom>(intercomId);

        const vtrack = new MediaStreamTrack({
            kind: "video", codec: requiredVideoCodec,
        });

        const atrack = new MediaStreamTrack({ kind: "audio" });
        const console = sdk.deviceManager.getMixinConsole(mediaObject?.sourceId || intercomId);

        const timeStart = Date.now();

        return {
            vtrack,
            atrack,
            intercom,
            createTrackForwarder: async (videoTransceiver: RTCRtpTransceiver, audioTransceiver: RTCRtpTransceiver) => {
                const ret = await createTrackForwarder({
                    timeStart,
                    ...isLocalIceTransport(this.pc),
                    requestMediaStream,
                    videoTransceiver,
                    audioTransceiver,
                    maximumCompatibilityMode: this.maximumCompatibilityMode,
                    clientOptions: this.clientOptions,
                });
                return ret;
            },
        }
    }

    get negotiation() {
        if (this.negotiationDeferred.finished)
            this.negotiationDeferred = new Deferred();
        return this.negotiationDeferred.promise;
    }

    async negotiateRTCSignalingSession() {
        return this.negotiateRTCSignalingSessionInternal({
            configuration: this.options?.configuration,
        });
    }

    async negotiateRTCSignalingSessionInternal(clientSetup: Partial<RTCAVSignalingSetup>, clientOffer?: boolean): Promise<void> {
        try {
            if (clientOffer) {
                await connectRTCSignalingClients(this.console,
                    this.clientSession, clientSetup,
                    this.weriftSignalingSession, {});
            }
            else {
                await connectRTCSignalingClients(this.console,
                    this.weriftSignalingSession, {},
                    this.clientSession, clientSetup,
                );
            }
            this.negotiationDeferred.resolve(undefined);
        }
        catch (e) {
            this.console.error('negotiation failed', e);
            this.negotiationDeferred.reject(e);
            throw e;
        }
    }

    async addTrack(mediaObject: MediaObject, options?: {
        videoMid?: string,
        audioMid?: string,
        intercomId?: string,
    }) {
        const { atrack, vtrack, createTrackForwarder, intercom } = await this.createTracks(mediaObject, options?.intercomId);

        const videoTransceiver = this.pc.addTransceiver(vtrack, {
            direction: 'sendonly',
        });

        videoTransceiver.mid = options?.videoMid;

        const audioTransceiver = this.pc.addTransceiver(atrack, {
            direction: intercom ? 'sendrecv' : 'sendonly',
        });
        audioTransceiver.mid = options?.audioMid;

        const ret = new WebRTCTrack(this, videoTransceiver, audioTransceiver, intercom);

        this.negotiation.then(async () => {
            try {
                this.console.log('waiting ice connected');
                if (this.pc.remoteIsBundled)
                    await waitConnected(this.pc);
                else
                    await waitIceConnected(this.pc);
                if (ret.removed.finished)
                    return;
                this.console.log('done waiting ice connected');
                const f = await createTrackForwarder(videoTransceiver, audioTransceiver);
                ret.attachForwarder(f);
                waitClosed(this.pc).finally(() => f?.kill());
                ret.removed.promise.finally(() => f?.kill());
            }
            catch (e) {
                this.console.error('Error starting playback for WebRTC track.', e);
                ret.cleanup(false);
            }
        });

        return ret;
    }

    async close(): Promise<void> {
        for (const track of this.activeTracks) {
            track.cleanup(true);
        }
        this.activeTracks.clear();
        this.pc.close();
    }

    async waitClosed() {
        await waitClosed(this.pc);
    }

    async waitConnected() {
        await waitIceConnected(this.pc);
        await waitConnected(this.pc);
    }
}

export async function createRTCPeerConnectionSink(
    clientSignalingSession: RTCSignalingSession,
    console: Console,
    intercom: ScryptedDevice & Intercom,
    mo: MediaObject,
    maximumCompatibilityMode: boolean,
    configuration: RTCConfiguration,
    weriftConfiguration: Partial<PeerConfig>,
    clientOffer = true,
) {
    const clientOptions = await legacyGetSignalingSessionOptions(clientSignalingSession);
    // console.log('remote options', clientOptions);

    const connection = new WebRTCConnectionManagement(console, clientSignalingSession, maximumCompatibilityMode, clientOptions, {
        configuration,
        weriftConfiguration,
    });

    const track = await connection.addTrack(mo, {
        intercomId: intercom?.id,
    });

    track.control.killed.promise.then(() => {
        track.cleanup(true);
        connection.pc.close();
    });

    const setup: Partial<RTCAVSignalingSetup> = {
        audio: {
            direction: intercom ? 'sendrecv' : 'recvonly',
        },
        video: {
            direction: 'recvonly',
        },
        configuration,
    };

    connection.negotiateRTCSignalingSessionInternal(setup, clientOffer);

    return track.control;
}
