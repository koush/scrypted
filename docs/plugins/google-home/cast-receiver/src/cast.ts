import { RpcPeer } from './rpc.js';
import { BrowserSignalingSession } from './rtc-signaling.js';

declare const eio: any;
declare const cast: any;

document.addEventListener("DOMContentLoaded", function (event) {
  const options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true;

  cast.framework.CastReceiverContext.getInstance().start(options);

  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();
  const video = document.getElementById('media') as HTMLVideoElement;

  // intercept the LOAD request to be able to read in a contentId and get data
  const interceptor: (loadRequestData: any) => void = (loadRequestData: any) => {
    console.log(loadRequestData);

    const eioUrl = loadRequestData.media.entity || loadRequestData.media.contentId;
    const token = loadRequestData.credentials ?? loadRequestData.media.customData.token;
    const url = new URL(eioUrl)
    const endpointPath = url.pathname;
    const query: any = {}
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
      socket.on('message', (data: any) => {
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

        const applyTracks = () => {
          const mediaStream = new MediaStream(
            pc.getReceivers().map((receiver) => receiver.track)
          );
          video.srcObject = mediaStream;
        }

        pc.ontrack = applyTracks;
        applyTracks();
      })

      rpcPeer.params['session'] = session;
    });

    return null;
  };

  playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, interceptor);
});
