import { EventEmitter } from 'events';
import dgram from 'dgram';
import { udpSocketType } from './utils';

/**
 * RTP Stream Switcher
 * Receives RTP packets from single source and sends to single active target
 * Supports seamless target switching without stopping the data source
 * Supports both IPv4 and IPv6
 */
export interface RtpTarget {
    ip: string;
    port: number;
    socket: dgram.Socket;
}

export class RtpStreamSwitcher extends EventEmitter 
{
    private currentTarget?: RtpTarget;
    private packetCount: number = 0;
    private targetSwitchCount: number = 0;

    constructor (private console: Console) {
        super();
    }

    /**
     * Switch to new RTP target
     * Old target will be closed gracefully
     */
    switchTarget (ip: string, port: number): void
    {
        const oldTarget = this.currentTarget;
        
        if (oldTarget) {
            this.console.debug (`Switching RTP target ${oldTarget.ip}:${oldTarget.port} -> ${ip}:${port} (${this.packetCount} packets sent)`);
            
            // Close old socket gracefully
            try {
                oldTarget.socket.close();
            } catch (e) {
                // Ignore errors on old socket
            }
            
            this.targetSwitchCount++;
        } else {
            this.console.debug (`Setting initial RTP target ${ip}:${port}`);
        }

        const socketType = udpSocketType (ip);
        const socket = dgram.createSocket (socketType);
        
        // Setup error handler for new socket
        socket.on ('error', (err) => {
            this.console.error (`Socket error for target ${ip}:${port}:`, err);
            if (this.currentTarget?.socket === socket) {
                this.clearTarget();
            }
        });

        this.currentTarget = { ip, port, socket };
        this.packetCount = 0;
        
        this.console.info (`RTP target set: ${ip}:${port} (${socketType})`);
    }

    /**
     * Clear current target without replacement
     */
    private clearTarget(): void
    {
        this.currentTarget = undefined;
    }

    /**
     * Send RTP packet to current active target
     */
    sendRtp (rtp: Buffer): void
    {
        if (!this.currentTarget) {
            // No active target, drop packet
            return;
        }

        this.packetCount++;

        try {
            this.currentTarget.socket.send (rtp, this.currentTarget.port, this.currentTarget.ip, (err) => {
                if (err) {
                    this.console.error (`Failed to send RTP packet:`, err);
                }
            });
        } catch (error) {
            this.console.error (`Error sending RTP packet:`, error);
            this.clearTarget();
        }

        if (this.packetCount % 100 === 0) {
            this.console.debug (`Sent ${this.packetCount} RTP packets to current target`);
        }
    }

    /**
     * Destroy switcher and cleanup
     */
    destroy(): void
    {
        this.console.debug (`Destroying RTP switcher (sent ${this.packetCount} packets, ${this.targetSwitchCount} switches)`);
        
        if (this.currentTarget) {
            try {
                this.currentTarget.socket.close();
            } catch (e) {
                // Ignore
            }
            this.currentTarget = undefined;
        }
        
        this.removeAllListeners();
    }
}
