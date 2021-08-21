import dgram, { Socket, SocketType } from "dgram";

export interface RTPProxyOptions {
  disabled: boolean;
  isIPV6?: boolean;
  outgoingAddress: string;
  outgoingPort: number;
  outgoingSSRC: number;
}

/**
 * RTPProxy to proxy unencrypted RTP and RTCP
 *
 * At early days of HomeKit camera support, HomeKit allowed for unencrypted RTP stream.
 * The proxy was created to deal with RTCP and SSRC related stuff from external streams back in that days.
 * Later HomeKit removed support for unencrypted stream so it’s mostly no longer useful anymore, only really for testing
 * with a custom HAP controller.
 */
export default class RTPProxy {

  startingPort: number = 10000;
  type: SocketType;
  outgoingAddress: string;
  outgoingPort: number;
  incomingPayloadType: number;
  outgoingSSRC: number;
  incomingSSRC: number | null;
  outgoingPayloadType: number | null;
  disabled: boolean;

  incomingRTPSocket!: Socket;
  incomingRTCPSocket!: Socket;
  outgoingSocket!: Socket;
  serverAddress?: string;
  serverRTPPort?: number;
  serverRTCPPort?: number;

  constructor(public options: RTPProxyOptions) {
    this.type = options.isIPV6 ? 'udp6' : 'udp4';

    this.startingPort = 10000;

    this.outgoingAddress = options.outgoingAddress;
    this.outgoingPort = options.outgoingPort;
    this.incomingPayloadType = 0;
    this.outgoingSSRC = options.outgoingSSRC;
    this.disabled = options.disabled;
    this.incomingSSRC = null;
    this.outgoingPayloadType = null;
  }

  setup = () => {
    return this.createSocketPair(this.type)
      .then((sockets) => {
        this.incomingRTPSocket = sockets[0];
        this.incomingRTCPSocket = sockets[1];

        return this.createSocket(this.type);
      }).then((socket) => {
        this.outgoingSocket = socket;
        this.onBound();
      });
  }

  destroy = () => {
    if (this.incomingRTPSocket) {
      this.incomingRTPSocket.close();
    }

    if (this.incomingRTCPSocket) {
      this.incomingRTCPSocket.close();
    }

    if (this.outgoingSocket) {
      this.outgoingSocket.close();
    }
  }

  incomingRTPPort = () => {
    const address = this.incomingRTPSocket.address();

    if (typeof address !== 'string') {
      return address.port;
    }
  }

  incomingRTCPPort = () => {
    const address = this.incomingRTCPSocket.address();

    if (typeof address !== 'string') {
      return address.port;
    }
  }

  outgoingLocalPort = () => {
    const address = this.outgoingSocket.address();

    if (typeof address !== 'string') {
      return address.port;
    }

    return 0; // won't happen
  }

  setServerAddress = (address: string) => {
    this.serverAddress = address;
  }

  setServerRTPPort = (port: number) => {
    this.serverRTPPort = port;
  }

  setServerRTCPPort = (port: number) => {
    this.serverRTCPPort = port;
  }

  setIncomingPayloadType = (pt: number) => {
    this.incomingPayloadType = pt;
  }

  setOutgoingPayloadType = (pt: number) => {
    this.outgoingPayloadType = pt;
  }

  sendOut = (msg: Buffer) => {
    // Just drop it if we're not setup yet, I guess.
    if(!this.outgoingAddress || !this.outgoingPort)
      return;

    this.outgoingSocket.send(msg, this.outgoingPort, this.outgoingAddress);
  }

  sendBack = (msg: Buffer) => {
    // Just drop it if we're not setup yet, I guess.
    if(!this.serverAddress || !this.serverRTCPPort)
      return;

    this.outgoingSocket.send(msg, this.serverRTCPPort, this.serverAddress);
  }

  onBound = () => {
    if(this.disabled)
      return;

    this.incomingRTPSocket.on('message', msg => {
      this.rtpMessage(msg);
    });

    this.incomingRTCPSocket.on('message', msg => {
      this.rtcpMessage(msg);
    });

    this.outgoingSocket.on('message', msg => {
      this.rtcpReply(msg);
    });
  }

  rtpMessage = (msg: Buffer) => {

    if(msg.length < 12) {
      // Not a proper RTP packet. Just forward it.
      this.sendOut(msg);
      return;
    }

    let mpt = msg.readUInt8(1);
    let pt = mpt & 0x7F;
    if(pt == this.incomingPayloadType) {
      // @ts-ignore
      mpt = (mpt & 0x80) | this.outgoingPayloadType;
      msg.writeUInt8(mpt, 1);
    }

    if(this.incomingSSRC === null)
      this.incomingSSRC = msg.readUInt32BE(4);

    msg.writeUInt32BE(this.outgoingSSRC, 8);
    this.sendOut(msg);
  }

  processRTCPMessage = (msg: Buffer, transform: (pt: number, packet: Buffer) => Buffer) => {
    let rtcpPackets = [];
    let offset = 0;
    while((offset + 4) <= msg.length) {
      let pt = msg.readUInt8(offset + 1);
      let len = msg.readUInt16BE(offset + 2) * 4;
      if((offset + 4 + len) > msg.length)
        break;
      let packet = msg.slice(offset, offset + 4 + len);

      packet = transform(pt, packet);

      if(packet)
        rtcpPackets.push(packet);

      offset += 4 + len;
    }

    if(rtcpPackets.length > 0)
      return Buffer.concat(rtcpPackets);

    return null;
  }

  rtcpMessage = (msg: Buffer) => {

    let processed = this.processRTCPMessage(msg, (pt, packet) => {
      if(pt != 200 || packet.length < 8)
        return packet;

      if(this.incomingSSRC === null)
        this.incomingSSRC = packet.readUInt32BE(4);
      packet.writeUInt32BE(this.outgoingSSRC, 4);
      return packet;
    });

    if(processed)
      this.sendOut(processed);
  }

  rtcpReply = (msg: Buffer) => {

    let processed = this.processRTCPMessage(msg, (pt, packet) => {
      if(pt != 201 || packet.length < 12)
        return packet;

      // Assume source 1 is the one we want to edit.
      // @ts-ignore
      packet.writeUInt32BE(this.incomingSSRC, 8);
      return packet;
    });


    if(processed)
      this.sendOut(processed);
  }

  createSocket = (type: SocketType): Promise<Socket> => {
    return new Promise(resolve => {
      const retry = () => {
        const socket = dgram.createSocket(type);

        const bindErrorHandler = () => {
          if(this.startingPort == 65535)
            this.startingPort = 10000;
          else
            ++this.startingPort;

          socket.close();
          retry();
        };

        socket.once('error', bindErrorHandler);

        socket.on('listening', () => {
          resolve(socket);
        });

        socket.bind(this.startingPort);
      };

      retry();
    });
  }

  createSocketPair = (type: SocketType): Promise<Socket[]> => {
    return new Promise(resolve => {
      const retry = () => {
        let socket1 = dgram.createSocket(type);
        let socket2 = dgram.createSocket(type);
        let state = {socket1: 0, socket2: 0};

        const recheck = () => {
          if(state.socket1 == 0 || state.socket2 == 0)
            return;

          if(state.socket1 == 2 && state.socket2 == 2) {
            resolve([socket1, socket2]);
            return;
          }

          if(this.startingPort == 65534)
            this.startingPort = 10000;
          else
            ++this.startingPort;

          socket1.close();
          socket2.close();

          retry();
        }

        socket1.once('error', function() {
          state.socket1 = 1;
          recheck();
        });

        socket2.once('error', function() {
          state.socket2 = 1;
          recheck();
        });

        socket1.once('listening', function() {
          state.socket1 = 2;
          recheck();
        });

        socket2.once('listening', function() {
          state.socket2 = 2;
          recheck();
        });

        socket1.bind(this.startingPort);
        socket2.bind(this.startingPort + 1);
      }

      retry();
    });
  }
}
