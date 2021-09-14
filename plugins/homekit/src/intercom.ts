import sdk from "@scrypted/sdk";
import { listenZeroCluster } from "@scrypted/common/src/listen-cluster";
import { FFMpegInput, Intercom, ScryptedDevice } from "@scrypted/sdk";
import { createSocket, Socket, SocketType } from "dgram";
import { createServer, Server } from "net";
import child_process from "child_process";
import { ffmpegLogInitialOutput } from "@scrypted/common/src/ffmpeg-helper";
import { FFMpegRebroadcastSession, startRebroadcastSession } from "@scrypted/common/src/ffmpeg-rebroadcast";

const { mediaManager } = sdk;

async function pickPort(socketType: SocketType) {
    // const socket = createSocket(socketType);
    // return await new Promise(resolve => socket.bind(0, () => {
    //     const { port } = socket.address();
    //     socket.close(() => resolve(port));
    // }));
    return Math.round(Math.abs(Math.random()) * 40000 + 10000);
}

export class IntercomSession {
    sdpReturnAudio: string;
    sdpServer: Server;
    session: FFMpegRebroadcastSession;
    port: number;
    heartbeatTimer: NodeJS.Timeout;

    constructor(public device: ScryptedDevice & Intercom, public socketType: SocketType, public address: string, public srtp: Buffer) {

    }

    async start(): Promise<FFMpegRebroadcastSession> {
        const sdpIpVersion = this.socketType === "udp6" ? "IP6 " : "IP4";
        this.port = await pickPort(this.socketType);

        // Session description protocol message that FFmpeg will share with HomeKit.
        // SDP messages tell the other side of the connection what we're expecting to receive.
        //
        // Parameters are:
        // v             protocol version - always 0.
        // o             originator and session identifier.
        // s             session description.
        // c             connection information.
        // t             timestamps for the start and end of the session.
        // m             media type - audio, adhering to RTP/AVP, payload type 110.
        // b             bandwidth information - application specific, 24k.
        // a=rtpmap      payload type 110 corresponds to an MP4 stream.
        // a=fmtp        for payload type 110, use these format parameters.
        // a=crypto      crypto suite to use for this session.
        this.sdpReturnAudio = [
            "v=0",
            "o=- 0 0 IN " + sdpIpVersion + " 127.0.0.1",
            "s=" + this.device.name + " Audio Talkback",
            "c=IN " + sdpIpVersion + " " + this.address,
            "t=0 0",
            "m=audio " + this.port + " RTP/AVP 110",
            "b=AS:24",
            "a=rtpmap:110 MPEG4-GENERIC/16000/1",
            "a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=F8F0212C00BC00",
            "a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:" + this.srtp.toString("base64")
        ].join("\n");

        this.sdpServer = createServer(socket => {
            this.sdpServer.close();
            socket.write(this.sdpReturnAudio);
            socket.end();
        });
        const sdpPort = await listenZeroCluster(this.sdpServer);
        console.log('sdp port', sdpPort);

        const ffmpegInput: FFMpegInput = {
            inputArguments: [
                "-f", "sdp",
                "-acodec", "libfdk_aac",
                "-ac", '1',
                "-i", `tcp://127.0.0.1:${sdpPort}`,
            ]
        };

        this.session = await startRebroadcastSession(ffmpegInput, {
            vcodec: ['-vn'],
            acodec: ['-acodec', 'libfdk_aac', '-ac', '1'],
            outputFormat: 'adts',
        });

        return this.session;
    }

    // Send a regular heartbeat to FFmpeg to ensure the pipe remains open and the process alive.
    heartbeat(socket: Socket, heartbeat: Buffer): void {

        // Clear the old heartbeat timer.
        clearTimeout(this.heartbeatTimer);

        // Send a heartbeat to FFmpeg every few seconds to keep things open. FFmpeg has a five-second timeout
        // in reading input, and we want to be comfortably within the margin for error to ensure the process
        // continues to run.
        this.heartbeatTimer = setTimeout(() => {
            socket.send(heartbeat, this.port);
            this.heartbeat(socket, heartbeat);

        }, 3.5 * 1000);
    }

    destroy() {
        this.sdpServer?.close();
        this.session?.kill();
    }
}