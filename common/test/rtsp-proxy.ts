import net from 'net';
import { listenZero } from '../src/listen-cluster';
import { RtspClient, RtspServer } from '../src/rtsp-server';

async function main() {
    const server = net.createServer(async serverSocket => {
        const client = new RtspClient('rtsp://localhost:57594/911db962087f904d');
        await client.options();
        const describeResponse = await client.describe();
        const sdp = describeResponse.body.toString();
        const server = new RtspServer(serverSocket, sdp, true);
        const setupResponse = await server.handlePlayback();
        if (setupResponse !== 'play') {
            serverSocket.destroy();
            client.client.destroy();
            return;
        }
        console.log('playback handled');

        let channel = 0;
        for (const track of Object.keys(server.setupTracks)) {
            const setupTrack = server.setupTracks[track];
            await client.setup({
                // type: 'udp',

                type: 'tcp',
                port: channel,

                path: setupTrack.control,
                onRtp(rtspHeader, rtp) {
                    server.sendTrack(setupTrack.control, rtp, false);
                },
            });

            channel += 2;
        }


        await client.play();
        console.log('client playing');
        await client.readLoop();
    });

    let port: number;
    if (false) {
        port = await listenZero(server);
    }
    else {
        port = 5555;
        server.listen(5555)
    }

    console.log(`rtsp://127.0.0.1:${port}`);
}

main();
