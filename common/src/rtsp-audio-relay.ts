import type { RtspServer } from './rtsp-server';

// A live audio consumer should not accumulate seconds of unbounded TCP output.
export const MAX_RTSP_AUDIO_BUFFER = 1024 * 1024;

export class RtspAudioRelay {
    private ready = false;
    private closed = false;
    private readonly onClose = () => this.close();

    constructor(private server: RtspServer, private onClosed: () => void) {
        server.client.once('close', this.onClose);
    }

    async start() {
        try {
            await this.server.handlePlayback();
            if (this.closed)
                return;
            this.ready = true;
            // PLAY only completes setup. Keep servicing GET_PARAMETER/OPTIONS
            // afterwards so the transcoder's control channel cannot fill up.
            await this.server.handleSetup(['teardown']);
        }
        finally {
            this.close();
        }
    }

    sendTrack(trackId: string, packet: Buffer, rtcp: boolean) {
        if (!this.ready || this.closed)
            return;
        if (this.server.client.writableLength >= MAX_RTSP_AUDIO_BUFFER) {
            this.close();
            return;
        }
        this.server.sendTrack(trackId, packet, rtcp);
    }

    close() {
        if (this.closed)
            return;
        this.closed = true;
        this.ready = false;
        this.server.client.removeListener('close', this.onClose);
        this.server.destroy();
        this.onClosed();
    }
}
