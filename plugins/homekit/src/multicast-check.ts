import dgram from 'dgram';

/*
 * On macOS, Local Network privacy blocks multicast from node binaries that lack a stable
 * code signature (e.g. Homebrew node). Sends fail with EHOSTUNREACH while unicast continues
 * to work, so the mDNS advertiser silently fails and accessories are never discovered.
 * Send a single empty mDNS packet to detect this.
 */
export function checkMulticastSend(): Promise<NodeJS.ErrnoException | undefined> {
    return new Promise(resolve => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        let finished = false;
        const finish = (e?: NodeJS.ErrnoException) => {
            if (finished)
                return;
            finished = true;
            socket.close();
            resolve(e);
        };
        socket.on('error', finish);
        // mDNS header with zero questions.
        socket.send(Buffer.alloc(12), 5353, '224.0.0.251', e => finish(e || undefined));
    });
}
