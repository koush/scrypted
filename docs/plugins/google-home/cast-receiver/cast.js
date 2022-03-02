import { RpcPeer } from './dist/rpc.js';
import { BrowserSignalingSession } from './dist/rtc-signaling.js';

document.addEventListener("DOMContentLoaded", function (event) {
  const options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true;

  cast.framework.CastReceiverContext.getInstance().start(options);

  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();
  const video = document.getElementById('media');

  // intercept the LOAD request to be able to read in a contentId and get data
  playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, loadRequestData => {
    console.log(loadRequestData);

    const eioUrl = loadRequestData.media.entity || loadRequestData.media.contentId;
    const token = loadRequestData.credentials ?? loadRequestData.media.customData.token;
    const url = new URL(eioUrl)
    const endpointPath = url.pathname;
    const query = {}
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

      const rpcPeer = new RpcPeer('cast-receiver', 'scrypted-server', (message, reject) => {
        try {
          socket.send(JSON.stringify(message));
        }
        catch (e) {
          reject?.(e);
        }
      });
      socket.on('message', data => {
        rpcPeer.handleMessage(JSON.parse(data));
      });

      const pc = new RTCPeerConnection();

      const session = new BrowserSignalingSession(pc, () => window.close());
      rpcPeer.params['session'] = session;
      // this is deprecated, and part of the session now.
      rpcPeer.params['options'] = session.options;

      pc.ontrack = () => {
        const mediaStream = new MediaStream(
          pc.getReceivers().map((receiver) => receiver.track)
        );
        video.srcObject = mediaStream;
        const remoteAudio = document.createElement("audio");
        remoteAudio.srcObject = mediaStream;
        remoteAudio.play();
      };
    });

    return null;
  });
});
