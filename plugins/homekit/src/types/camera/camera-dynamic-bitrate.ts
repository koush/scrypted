import { RtcpRrPacket } from '@koush/werift/packages/rtp/src/rtcp/rr';

export class DynamicBitrateSession {
    currentBitrate: number;
    lastReconfigure: number;
    lastPerfectBitrate: number;
    lastTotalPacketsLost = 0;

    constructor(initialBitrate: number, public minBitrate: number, public maxBitrate: number, public console?: Console) {
        this.currentBitrate = initialBitrate;
        this.lastPerfectBitrate = initialBitrate;
    }

    onBitrateReconfigured(currentBitrate: number) {
        this.currentBitrate = currentBitrate;
        this.lastReconfigure = Date.now();
    }

    shouldReconfigureBitrate(rr: RtcpRrPacket): boolean {
        // allow 4 seconds-ish to pass, 1 keyframe, before
        // attempting to reconfigure.
        const now = Date.now();
        if (now - this.lastReconfigure < 4100)
            return;

        let totalPacketsLost = 0;
        for (const report of rr.reports) {
            totalPacketsLost += report.packetsLost;
        }

        const packetsLost = totalPacketsLost - this.lastTotalPacketsLost;
        this.lastTotalPacketsLost = totalPacketsLost;
        // what is an acceptable percentage of packet loss?
        if (packetsLost === 0) {
            this.lastPerfectBitrate = this.currentBitrate;
            if (this.currentBitrate >= this.maxBitrate)
                return;
            // what is a good rampup? this should be tuned with
            // the reconfigure interval.
            this.currentBitrate = Math.round(this.currentBitrate * 1.5);
        }
        else {
            if (this.currentBitrate <= this.minBitrate)
                return;
            if (this.currentBitrate > this.lastPerfectBitrate) {
                // slow creep back up will eventually stabilize at a bitrate
                // that has minimal packet loss.
                this.currentBitrate = Math.round(this.lastPerfectBitrate * 1.05);
                // degrade the last perfect bitrate in case network conditions changed.
                this.lastPerfectBitrate = Math.round(this.lastPerfectBitrate * .95);
            }
            else {
                this.currentBitrate = Math.round(this.currentBitrate / 2);
            }
        }

        this.currentBitrate = Math.max(this.minBitrate, this.currentBitrate);
        this.currentBitrate = Math.min(this.maxBitrate, this.currentBitrate);

        this.console?.log('Packets lost:', packetsLost);
        return true;
    };
}
