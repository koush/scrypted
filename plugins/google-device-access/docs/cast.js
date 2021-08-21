
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

document.addEventListener("DOMContentLoaded", function (event) {
  const options = new cast.framework.CastReceiverOptions();
  options.disableIdleTimeout = true;

  cast.framework.CastReceiverContext.getInstance().start(options);

  const context = cast.framework.CastReceiverContext.getInstance();
  const playerManager = context.getPlayerManager();

  // intercept the LOAD request to be able to read in a contentId and get data
  playerManager.setMessageInterceptor(cast.framework.messages.MessageType.LOAD, loadRequestData => {
    console.log(loadRequestData);

    const cameraUrl = loadRequestData.media.entity || loadRequestData.media.contentId;
    const eioUrl = loadRequestData.credentials ?? loadRequestData.media.customData.eioUrl;
    const url = new URL(eioUrl)
    const endpointPath = url.pathname + url.search;

    const options = {
      path: endpointPath,
    };

    const socket = eio(`wss://${url.host}`, options);
    socket.on('open', () => {
      socket.send(cameraUrl);

      const video = document.getElementById('media');

      socket.on('message', async (data) => {
        const json = JSON.parse(data);
        const answerObject = {
          id: json.id,
          candidates: [],
        };

        const pc = new RTCPeerConnection(json.configuration);
        const checkConn = () => {
          pc.onconnectionstatechange = () => console.log(pc.connectionState);
          if (pc.iceConnectionState === 'failed' || pc.connectionState === 'failed') {
            window.close();
          }
        }

        pc.onconnectionstatechange = checkConn;
        pc.onsignalingstatechange = checkConn;
        pc.ontrack = () => {
          const mediaStream = new MediaStream(
            pc.getReceivers().map((receiver) => receiver.track)
          );
          video.srcObject = mediaStream;
          const remoteAudio = document.createElement("audio");
          remoteAudio.srcObject = mediaStream;
          remoteAudio.play();
        };
        pc.onicecandidate = async (evt) => {
          answerObject.candidates.push(evt.candidate);
        };
        await pc.setRemoteDescription(json.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        answerObject.description = answer;
        await sleep(2000);
        socket.send(JSON.stringify(answerObject));
      })

    });

    return null;
  });
});
