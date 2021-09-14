/* Copyright(C) 2017-2021, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * protect-rtp.ts: RTP-related utilities to slice and dice RTP streams.
 *
 * This module is heavily inspired by the homebridge and homebridge-camera-ffmpeg source code and
 * borrows heavily from both. Thank you for your contributions to the HomeKit world.
 */
import { Socket } from "dgram";
import { EventEmitter } from "stream";

// How often, in seconds, should we heartbeat FFmpeg in two-way audio sessions. This should be less than 5 seconds, which is
// FFmpeg's input timeout interval.
export const PROTECT_TWOWAY_HEARTBEAT_INTERVAL = 3.5;

/*
 * Here's the problem this class solves: FFmpeg doesn't support multiplexing RTP and RTCP data on a single UDP port (RFC 5761).
 * If it did, we wouldn't need this workaround for HomeKit compatibility, which does multiplex RTP and RTCP over a single UDP port.
 *
 * This class inspects all packets coming in from inputPort and demultiplexes RTP and RTCP traffic to rtpPort and rtcpPort, respectively.
 *
 * Credit to @dgreif and @brandawg93 who graciously shared their code as a starting point, and their collaboration
 * in answering the questions needed to bring all this together. A special thank you to @Sunoo for the many hours of
 * discussion and brainstorming on this and other topics.
 */
export class RtpDemuxer extends EventEmitter {
    private heartbeatTimer!: NodeJS.Timeout;
    private heartbeatMsg!: Buffer;

    // Create an instance of RtpDemuxer.
    constructor(public deviceName: string, public console: Console, public socket: Socket) {
        super();
        // Catch errors when they happen on our demuxer.
        this.socket.on("error", (error) => {
            this.console.error("%s: RtpDemuxer Error: %s", this.deviceName, error);
            this.socket.close();
        });

        // Split the message into RTP and RTCP packets.
        this.socket.on("message", (msg) => {

            // Send RTP packets to the RTP port.
            if (this.isRtpMessage(msg)) {
                this.emit('rtp', msg);
            } else {
                this.emit('rtcp', msg);
            }
        });

        this.console.log("%s: Creating an RtpDemuxer instance - inbound port: %s, RTCP port: %s, RTP port: %s.",
            this.deviceName);
    }

    // Close the socket and cleanup.
    public close(): void {
        this.console.log("%s: Closing the RtpDemuxer instance on port %s.", this.deviceName);

        clearTimeout(this.heartbeatTimer);
        this.socket.close();
    }

    // Retrieve the payload information from a packet to discern what the packet payload is.
    private getPayloadType(message: Buffer): number {
        return message.readUInt8(1) & 0x7f;
    }

    // Return whether or not a packet is RTP (or not).
    private isRtpMessage(message: Buffer): boolean {
        const payloadType = this.getPayloadType(message);

        return (payloadType > 90) || (payloadType === 0);
    }
}
