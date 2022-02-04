
async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

      socket.once('message', async (data) => {
        const avsource = JSON.parse(data);
        console.log(avsource);

        const pc = new RTCPeerConnection();

        const iceDone = new Promise(resolve => {
          pc.onicecandidate = evt => {
            if (!evt.candidate) {
              resolve(undefined);
            }
          }
        });

        if (avsource.datachannel)
          pc.createDataChannel(avsource.datachannel.label, avsource.datachannel.dict);
        // it's possible to do talkback to ring.
        let useAudioTransceiver = false;
        if (avsource.audio?.direction === 'sendrecv') {
          try {
            // doing sendrecv on safari requires a mic be attached, or it fails to connect.
            const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: true })
            for (const track of mic.getTracks()) {
              pc.addTrack(track);
            }
          }
          catch (e) {
            let silence = () => {
              let ctx = new AudioContext(), oscillator = ctx.createOscillator();
              let dst = oscillator.connect(ctx.createMediaStreamDestination());
              oscillator.start();
              return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false });
            }
            pc.addTrack(silence());
          }
        }
        else {
          useAudioTransceiver = true;
        }
        if (useAudioTransceiver)
          pc.addTransceiver("audio", avsource.audio);
        pc.addTransceiver("video", avsource.video);

        const checkConn = () => {
          console.log(pc.connectionState, pc.iceConnectionState);
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

        let offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        await iceDone;
        offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true
        });
        await pc.setLocalDescription(offer);
        const message = {
          token,
          offer: {
            description: offer,
          }
        };
        socket.send(JSON.stringify(message));

        socket.once('message', async (data) => {
          const json = JSON.parse(data);
          await pc.setRemoteDescription(json.description);
        })
      })
    });

    return null;
  });
});
