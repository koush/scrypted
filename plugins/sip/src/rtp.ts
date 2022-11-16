import { createSocket, RemoteInfo, Socket } from "dgram";

export class RtpHelper {
  private readonly logPrefix: string;
  private readonly console: any;
  private inputPort: number;
  private inputRtcpPort: number;
  public readonly rtpSocket: Socket;
  public readonly rtcpSocket?: Socket;

  // Create an instance of RtpHelper.
  constructor(console: any, logPrefix: string, ipFamily: ("ipv4" | "ipv6") , inputPort: number, inputRtcpPort: number, rtcpPort: number, rtpPort: number, 
                                                                            sendAddress: string, sendPort: number, sendRtcpPort: number) {

    this.console = console;
    this.logPrefix = logPrefix;
    this.inputPort = inputPort;
    this.inputRtcpPort = inputRtcpPort;
    this.rtpSocket = createSocket(ipFamily === "ipv6" ? "udp6" : "udp4" );
    this.rtcpSocket = (inputPort !== inputRtcpPort) ? createSocket(ipFamily === "ipv6" ? "udp6" : "udp4" ) : undefined;

    // Catch errors when they happen on our demuxer.
    this.rtpSocket.on("error", (error)  => {
      this.console.error("RtpHelper (RTP) Error: " + error, this.logPrefix);
      this.rtpSocket.close();
    });

    // Catch errors when they happen on our demuxer.
    this.rtcpSocket?.on("error", (error)  => {
        this.console.error("RtpHelper (RTCP) Error: " + error, this.logPrefix);
        this.rtcpSocket?.close();
    });
      
    // Split the message into RTP and RTCP packets.
    this.rtpSocket.on("message", (msg: Buffer, rinfo: RemoteInfo) => {

      // Check if we have to forward a packet from ffmpeg to the external peer
      if (rinfo.address === '127.0.0.1')
      {
        this.rtpSocket.send(msg, sendPort, sendAddress);
        return;
      }

      // Send RTP packets to the RTP port.
      if(this.isRtpMessage(msg)) {

        this.rtpSocket.send(msg, rtpPort);

      } else {
        this.rtpSocket.send(msg, rtcpPort);
      }
    });

    // Split the message into RTP and RTCP packets.
    this.rtcpSocket?.on("message", (msg: Buffer, rinfo: RemoteInfo) => {

        // Check if we have to forward a packet from ffmpeg to the external peer
        if (rinfo.address === '127.0.0.1')
        {
            this.rtcpSocket?.send(msg, sendRtcpPort, sendAddress);
            return;
        }
    
        // Send RTP packets to the RTP port.
        if(this.isRtpMessage(msg)) {
            this.rtcpSocket?.send(msg, rtpPort);
        } else {
            this.rtcpSocket?.send(msg, rtcpPort);
    
        }
    });
      
    this.console.debug("Creating RtpHelper instance - inbound port: " + this.inputPort + ", RTCP port: " + rtcpPort + ", RTP port: " + rtpPort, this.logPrefix);

    // Take the socket live.
    this.rtpSocket.bind(this.inputPort);
    this.rtcpSocket?.bind(this.inputRtcpPort);
  }

  // Close the socket and cleanup.
  public close(): void {
    this.console.debug("Closing RtpHelper instance on port: " + this.inputPort, this.logPrefix);

    this.rtpSocket.close();
    this.rtcpSocket?.close();
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
