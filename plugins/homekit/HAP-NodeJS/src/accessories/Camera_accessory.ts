import {
    Accessory,
    CameraController,
    CameraStreamingDelegate,
    Categories,
    H264Level,
    H264Profile,
    PrepareStreamCallback,
    PrepareStreamRequest,
    PrepareStreamResponse,
    SnapshotRequest,
    SnapshotRequestCallback,
    SRTPCryptoSuites,
    StreamingRequest,
    StreamRequestCallback,
    StreamRequestTypes,
    StreamSessionIdentifier,
    uuid,
    VideoInfo
} from "..";
import { ChildProcess, spawn } from "child_process";

const cameraUUID = uuid.generate('hap-nodejs:accessories:ip-camera');
const camera = exports.accessory = new Accessory('IPCamera', cameraUUID);

// @ts-ignore
camera.username = "9F:B2:46:0C:40:DB";
// @ts-ignore
camera.pincode = "948-23-459";
camera.category = Categories.IP_CAMERA;

type SessionInfo = {
    address: string, // address of the HAP controller

    videoPort: number, // port of the controller
    localVideoPort: number,
    videoCryptoSuite: SRTPCryptoSuites, // should be saved if multiple suites are supported
    videoSRTP: Buffer, // key and salt concatenated
    videoSSRC: number, // rtp synchronisation source

    /* Won't be save as audio is not supported by this example
    audioPort: number,
    audioCryptoSuite: SRTPCryptoSuites,
    audioSRTP: Buffer,
    audioSSRC: number,
     */
}

type OngoingSession = {
    localVideoPort: number,
    process: ChildProcess,
}

const FFMPEGH264ProfileNames = [
    "baseline",
    "main",
    "high"
];
const FFMPEGH264LevelNames = [
    "3.1",
    "3.2",
    "4.0"
];

const ports = new Set<number>();

function getPort(): number {
    for (let i = 5011;; i++) {
        if (!ports.has(i)) {
            ports.add(i);
            return i;
        }
    }
}

class ExampleCamera implements CameraStreamingDelegate {

    private ffmpegDebugOutput: boolean = false;

    controller?: CameraController;

    // keep track of sessions
    pendingSessions: Record<string, SessionInfo> = {};
    ongoingSessions: Record<string, OngoingSession> = {};

    handleSnapshotRequest(request: SnapshotRequest, callback: SnapshotRequestCallback): void {
        const ffmpegCommand = `-f lavfi -i testsrc=s=${request.width}x${request.height} -vframes 1 -f mjpeg -`;
        const ffmpeg = spawn("ffmpeg", ffmpegCommand.split(" "), {env: process.env});

        const snapshotBuffers: Buffer[] = [];

        ffmpeg.stdout.on('data', data => snapshotBuffers.push(data));
        ffmpeg.stderr.on('data', data => {
            if (this.ffmpegDebugOutput) {
                console.log("SNAPSHOT: " + String(data));
            }
        });

        ffmpeg.on('exit', (code, signal) => {
            if (signal) {
                console.log("Snapshot process was killed with signal: " + signal);
                callback(new Error("killed with signal " + signal));
            } else if (code === 0) {
                console.log(`Successfully captured snapshot at ${request.width}x${request.height}`);
                callback(undefined, Buffer.concat(snapshotBuffers));
            } else {
                console.log("Snapshot process exited with code " + code);
                callback(new Error("Snapshot process exited with code " + code));
            }
        });
    }

    // called when iOS request rtp setup
    prepareStream(request: PrepareStreamRequest, callback: PrepareStreamCallback): void {
        const sessionId: StreamSessionIdentifier = request.sessionID;
        const targetAddress = request.targetAddress;

        const video = request.video;

        const videoCryptoSuite = video.srtpCryptoSuite; // could be used to support multiple crypto suite (or support no suite for debugging)
        const videoSrtpKey = video.srtp_key;
        const videoSrtpSalt = video.srtp_salt;

        const videoSSRC = CameraController.generateSynchronisationSource();

        const localPort = getPort();

        const sessionInfo: SessionInfo = {
            address: targetAddress,

            videoPort: video.port,
            localVideoPort: localPort,
            videoCryptoSuite: videoCryptoSuite,
            videoSRTP: Buffer.concat([videoSrtpKey, videoSrtpSalt]),
            videoSSRC: videoSSRC,
        };

        const response: PrepareStreamResponse = {
            video: {
                port: localPort,
                ssrc: videoSSRC,

                srtp_key: videoSrtpKey,
                srtp_salt: videoSrtpSalt,
            },
            // audio is omitted as we do not support audio in this example
        };

        this.pendingSessions[sessionId] = sessionInfo;
        callback(undefined, response);
    }

    // called when iOS device asks stream to start/stop/reconfigure
    handleStreamRequest(request: StreamingRequest, callback: StreamRequestCallback): void {
        const sessionId = request.sessionID;

        switch (request.type) {
            case StreamRequestTypes.START: {
                const sessionInfo = this.pendingSessions[sessionId];

                const video: VideoInfo = request.video;

                const profile = FFMPEGH264ProfileNames[video.profile];
                const level = FFMPEGH264LevelNames[video.level];
                const width = video.width;
                const height = video.height;
                const fps = video.fps;

                const payloadType = video.pt;
                const maxBitrate = video.max_bit_rate;
                const rtcpInterval = video.rtcp_interval; // usually 0.5
                const mtu = video.mtu; // maximum transmission unit

                const address = sessionInfo.address;
                const videoPort = sessionInfo.videoPort;
                const localVideoPort = sessionInfo.localVideoPort;
                const ssrc = sessionInfo.videoSSRC;
                const cryptoSuite = sessionInfo.videoCryptoSuite;
                const videoSRTP = sessionInfo.videoSRTP.toString("base64");

                console.log(`Starting video stream (${width}x${height}, ${fps} fps, ${maxBitrate} kbps, ${mtu} mtu)...`);

                let videoffmpegCommand = `-re -f lavfi -i testsrc=s=${width}x${height}:r=${fps} -map 0:0 ` +
                  `-c:v h264 -pix_fmt yuv420p -r ${fps} -an -sn -dn -b:v ${maxBitrate}k ` +
                  `-profile:v ${profile} -level:v ${level} ` +
                  `-payload_type ${payloadType} -ssrc ${ssrc} -f rtp `;

                if (cryptoSuite !== SRTPCryptoSuites.NONE) {
                    let suite: string;
                    switch (cryptoSuite) {
                        case SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80: // actually ffmpeg just supports AES_CM_128_HMAC_SHA1_80
                            suite = "AES_CM_128_HMAC_SHA1_80";
                            break;
                        case SRTPCryptoSuites.AES_CM_256_HMAC_SHA1_80:
                            suite = "AES_CM_256_HMAC_SHA1_80";
                            break;
                    }

                    videoffmpegCommand += `-srtp_out_suite ${suite} -srtp_out_params ${videoSRTP} s`;
                }

                videoffmpegCommand += `rtp://${address}:${videoPort}?rtcpport=${videoPort}&localrtcpport=${localVideoPort}&pkt_size=${mtu}`;

                if (this.ffmpegDebugOutput) {
                    console.log("FFMPEG command: ffmpeg " + videoffmpegCommand);
                }

                const ffmpegVideo = spawn('ffmpeg', videoffmpegCommand.split(' '), {env: process.env});

                let started = false;
                ffmpegVideo.stderr.on('data', (data: Buffer) => {
                    console.log(data.toString("utf8"));
                    if (!started) {
                        started = true;
                        console.log("FFMPEG: received first frame");

                        callback(); // do not forget to execute callback once set up
                    }

                    if (this.ffmpegDebugOutput) {
                        console.log("VIDEO: " + String(data));
                    }
                });
                ffmpegVideo.on('error', error => {
                    console.log("[Video] Failed to start video stream: " + error.message);
                    callback(new Error("ffmpeg process creation failed!"));
                });
                ffmpegVideo.on('exit', (code, signal) => {
                    const message = "[Video] ffmpeg exited with code: " + code + " and signal: " + signal;

                    if (code == null || code === 255) {
                        console.log(message + " (Video stream stopped!)");
                    } else {
                        console.log(message + " (error)");

                        if (!started) {
                            callback(new Error(message));
                        } else {
                            this.controller!.forceStopStreamingSession(sessionId);
                        }
                    }
                });

                this.ongoingSessions[sessionId] = {
                    localVideoPort: localVideoPort,
                    process: ffmpegVideo,
                };
                delete this.pendingSessions[sessionId];

                break;
            }
            case StreamRequestTypes.RECONFIGURE:
                // not supported by this example
                console.log("Received (unsupported) request to reconfigure to: " + JSON.stringify(request.video));
                callback();
                break;
            case StreamRequestTypes.STOP:
                const ongoingSession = this.ongoingSessions[sessionId];

                ports.delete(ongoingSession.localVideoPort);

                try {
                    ongoingSession.process.kill('SIGKILL');
                } catch (e) {
                    console.log("Error occurred terminating the video process!");
                    console.log(e);
                }

                delete this.ongoingSessions[sessionId];

                console.log("Stopped streaming session!");
                callback();
                break;
        }
    }

}

const streamDelegate = new ExampleCamera();
const cameraController = new CameraController({
    cameraStreamCount: 2, // HomeKit requires at least 2 streams, but 1 is also just fine
    delegate: streamDelegate,

    streamingOptions: {
        // srtp: true, // legacy option which will just enable AES_CM_128_HMAC_SHA1_80 (can still be used though)
        supportedCryptoSuites: [SRTPCryptoSuites.NONE, SRTPCryptoSuites.AES_CM_128_HMAC_SHA1_80], // NONE is not supported by iOS just there for testing with Wireshark for example
        video: {
            codec: {
                profiles: [H264Profile.BASELINE, H264Profile.MAIN, H264Profile.HIGH],
                levels: [H264Level.LEVEL3_1, H264Level.LEVEL3_2, H264Level.LEVEL4_0],
            },
            resolutions: [
                [1920, 1080, 30], // width, height, framerate
                [1280, 960, 30],
                [1280, 720, 30],
                [1024, 768, 30],
                [640, 480, 30],
                [640, 360, 30],
                [480, 360, 30],
                [480, 270, 30],
                [320, 240, 30],
                [320, 240, 15], // Apple Watch requires this configuration (Apple Watch also seems to required OPUS @16K)
                [320, 180, 30],
            ],
        },
        /* audio option is omitted, as it is not supported in this example; HAP-NodeJS will fake an appropriate audio codec
        audio: {
            comfort_noise: false, // optional, default false
            codecs: [
                {
                    type: AudioStreamingCodecType.OPUS,
                    audioChannels: 1, // optional, default 1
                    samplerate: [AudioStreamingSamplerate.KHZ_16, AudioStreamingSamplerate.KHZ_24], // 16 and 24 must be present for AAC-ELD or OPUS
                },
            ],
        },
        // */
    }
});
streamDelegate.controller = cameraController;

camera.configureController(cameraController);
