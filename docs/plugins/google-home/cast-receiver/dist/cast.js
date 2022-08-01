import { RpcPeer } from './rpc';
import { BrowserSignalingSession } from './rtc-signaling';
document.addEventListener("DOMContentLoaded", function (event) {
    const options = new cast.framework.CastReceiverOptions();
    options.disableIdleTimeout = true;
    cast.framework.CastReceiverContext.getInstance().start(options);
    const context = cast.framework.CastReceiverContext.getInstance();
    const playerManager = context.getPlayerManager();
    const video = document.getElementById('media');
    // intercept the LOAD request to be able to read in a contentId and get data
    const interceptor = (loadRequestData) => {
        console.log(loadRequestData);
        const eioUrl = loadRequestData.media.entity || loadRequestData.media.contentId;
        const token = loadRequestData.credentials ?? loadRequestData.media.customData.token;
        const url = new URL(eioUrl);
        const endpointPath = url.pathname;
        const query = {};
        for (const [k, v] of new URLSearchParams(url.search)) {
            query[k] = v;
        }
        const options = {
            path: endpointPath,
            query,
        };
        const socket = eio(`wss://${url.host}`, options);
        socket.on('open', async () => {
            socket.send(JSON.stringify({
                token,
            }));
            const rpcPeer = new RpcPeer('cast-receiver', 'host', (message, reject) => {
                try {
                    socket.send(JSON.stringify(message));
                }
                catch (e) {
                    reject?.(e);
                }
            });
            socket.on('message', (data) => {
                rpcPeer.handleMessage(JSON.parse(data));
            });
            const cleanup = () => window.close();
            const session = new BrowserSignalingSession();
            session.pcDeferred.promise.then(pc => {
                pc.addEventListener('connectionstatechange', () => {
                    if (pc.iceConnectionState === 'disconnected'
                        || pc.iceConnectionState === 'failed'
                        || pc.iceConnectionState === 'closed') {
                        cleanup();
                    }
                });
                pc.addEventListener('iceconnectionstatechange', () => {
                    console.log('iceConnectionStateChange', pc.connectionState, pc.iceConnectionState);
                    if (pc.iceConnectionState === 'disconnected'
                        || pc.iceConnectionState === 'failed'
                        || pc.iceConnectionState === 'closed') {
                        cleanup();
                    }
                });
                const mediaStream = new MediaStream(pc.getReceivers().map((receiver) => receiver.track));
                video.srcObject = mediaStream;
            });
            rpcPeer.params['session'] = session;
        });
        return null;
    };
    playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, interceptor);
});
//# sourceMappingURL=cast.js.map