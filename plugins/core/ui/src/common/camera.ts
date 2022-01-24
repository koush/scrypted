import { ScryptedDevice, ScryptedMimeTypes, RTCAVMessage, MediaManager, VideoCamera, MediaStreamOptions, MediaObject } from '@scrypted/sdk/types';

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & VideoCamera, getVideo: () => HTMLVideoElement, createPeerConnection: (configuration: RTCConfiguration) => RTCPeerConnection) {
  let selectedStream: MediaStreamOptions;
  try {
    const streams = await device.getVideoStreamOptions();
    selectedStream = streams.find(stream => stream.container.startsWith(ScryptedMimeTypes.RTCAVSignalingPrefix));
    if (!selectedStream)
      selectedStream = streams.find(stream => stream.container === 'rawvideo');
  }
  catch (e) {
  }
  const videoStream = await device.getVideoStream(selectedStream);

  let trickle = true;
  let pc: RTCPeerConnection;
  let json: RTCAVMessage;
  if (videoStream.mimeType.startsWith(ScryptedMimeTypes.RTCAVSignalingPrefix)) {
    trickle = false;
    pc = createPeerConnection({})
    pc.createDataChannel("dataSendChannel");
    pc.addTransceiver("audio", {
      direction: 'recvonly'
    });
    pc.addTransceiver("video", {
      direction: 'recvonly',
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
  }
  else {
    const offer = await mediaManager.convertMediaObjectToBuffer(
      videoStream,
      ScryptedMimeTypes.RTCAVOffer
    );
    json = JSON.parse(offer.toString());
    pc = createPeerConnection(json.configuration);
  }
  try {

    pc.onconnectionstatechange = () => console.log(pc.connectionState);
    pc.onsignalingstatechange = () => console.log(pc.connectionState);
    pc.ontrack = () => {
      const mediaStream = new MediaStream(
        pc.getReceivers().map((receiver) => receiver.track)
      );
      getVideo().srcObject = mediaStream;
      const remoteAudio = document.createElement("audio");
      remoteAudio.srcObject = mediaStream;
      remoteAudio.play();
      console.log('done tracks');
    };

    const processCandidates = (result: Buffer) => {
      const message: RTCAVMessage = JSON.parse(result.toString());
      for (const candidate of message.candidates) {
        // console.log('remote candidate', candidate);
        pc.addIceCandidate(candidate);
      }
    };

    pc.onicecandidate = async (evt) => {
      if (!evt.candidate) {
        if (!trickle) {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true,
          });
          await pc.setLocalDescription(offer);

          const offerWithCandidates: RTCAVMessage = {
            id: undefined,
            candidates: [],
            description: {
              sdp: offer.sdp,
              type: 'offer',
            },
            configuration: {},
          };
          const mo = await mediaManager.createMediaObject(
            Buffer.from(JSON.stringify(offerWithCandidates)),
            ScryptedMimeTypes.RTCAVOffer
          );
          const result = await mediaManager.convertMediaObjectToBuffer(
            mo,
            videoStream.mimeType
          );
          const answer: RTCAVMessage = JSON.parse(result.toString())
          console.log(answer);
          await pc.setRemoteDescription(answer.description);
        }
        return;
      }
      if (!trickle) {
        return;
      }
      // console.log('local candidate', evt.candidate);
      const candidateObject: RTCAVMessage = {
        id: json.id,
        candidates: [evt.candidate],
        description: null,
        configuration: null,
      };
      const mo = await mediaManager.createMediaObject(
        Buffer.from(JSON.stringify(candidateObject)),
        ScryptedMimeTypes.RTCAVAnswer
      );
      const result = await mediaManager.convertMediaObjectToBuffer(
        mo,
        ScryptedMimeTypes.RTCAVOffer
      );
      processCandidates(result);
    };

    if (!trickle)
      return pc;

    await pc.setRemoteDescription(json.description);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    const answerObject: RTCAVMessage = {
      id: json.id,
      candidates: [],
      description: null,
      configuration: json.configuration,
    };
    answerObject.description = answer;
    const mo = await mediaManager.createMediaObject(
      Buffer.from(JSON.stringify(answerObject)),
      ScryptedMimeTypes.RTCAVAnswer
    );
    const result = await mediaManager.convertMediaObjectToBuffer(
      mo,
      ScryptedMimeTypes.RTCAVOffer
    );
    processCandidates(result);

    (async () => {
      const emptyObject: RTCAVMessage = {
        id: json.id,
        candidates: [],
        description: null,
        configuration: null,
      };
      while (true) {
        const mo = await mediaManager.createMediaObject(
          Buffer.from(JSON.stringify(emptyObject)),
          ScryptedMimeTypes.RTCAVAnswer
        );
        const result = await mediaManager.convertMediaObjectToBuffer(
          mo,
          ScryptedMimeTypes.RTCAVOffer
        );
        processCandidates(result);
      }
    })();
    console.log("done av offer");

    return pc;
  }
  catch (e) {
    pc.close();
    throw e;
  }
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
