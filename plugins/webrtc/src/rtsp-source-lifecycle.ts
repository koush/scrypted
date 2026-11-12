import type { Duplex } from 'stream';

interface TrackSender {
    sendTrack(track: string, packet: Buffer, rtcp: boolean): unknown;
}

function isClosedSocketError(error: unknown) {
    return ['EPIPE', 'ECONNRESET', 'ERR_STREAM_DESTROYED'].includes((error as NodeJS.ErrnoException)?.code);
}

export function createRtspSourceLifecycle(clientPromise: Promise<Duplex>, onCleanup: () => void, console: Pick<Console, 'warn'>) {
    let closed = false;
    let client: Duplex;

    const cleanup = () => {
        if (closed)
            return;
        closed = true;
        clientPromise.then(client => client.destroy()).catch(() => { });
        onCleanup();
    };

    const socketError = (error: unknown) => {
        cleanup();
        if (!isClosedSocketError(error))
            console.warn('RTSP source socket error', error);
    };

    clientPromise.then(socket => {
        client = socket;
        socket.once('end', cleanup);
        socket.once('close', cleanup);
        // Keep handling errors after cleanup: an in-flight write can fail later.
        socket.on('error', socketError);
        if (socket.destroyed || socket.readableEnded || socket.writableEnded || !socket.writable)
            cleanup();
    }).catch(cleanup);

    const sendTrack = (server: TrackSender, track: string, packet: Buffer, rtcp: boolean) => {
        if (closed || !client || client.destroyed || client.readableEnded || client.writableEnded || !client.writable) {
            cleanup();
            return;
        }
        try {
            return server.sendTrack(track, packet, rtcp);
        }
        catch (error) {
            cleanup();
            if (!isClosedSocketError(error))
                console.warn('RTSP forwarding stopped after write failure', error);
        }
    };

    return { cleanup, sendTrack };
}
