import { RTCSignalingSendIceCandidate, RTCSignalingSession, ScryptedInterface, ScryptedDevice, ScryptedMimeTypes, RTCAVMessage, MediaManager, VideoCamera, MediaObject, RTCAVSignalingSetup, RequestMediaStreamOptions, RTCSignalingChannel } from '@scrypted/types';

async function startCameraLegacy(mediaManager: MediaManager, device: ScryptedDevice & VideoCamera & RTCSignalingChannel) {
  let selectedStream: RequestMediaStreamOptions;
  try {
    const streams = await device.getVideoStreamOptions();
    selectedStream = streams.find(stream => stream.container === 'rawvideo');
  }
  catch (e) {
  }
  const videoStream = await device.getVideoStream(selectedStream);

  let json: RTCAVMessage;

  const offer = await mediaManager.convertMediaObjectToBuffer(
    videoStream,
    ScryptedMimeTypes.RTCAVOffer
  );
  json = JSON.parse(offer.toString());
  let pc = new RTCPeerConnection(json.configuration);

  const processCandidates = (result: Buffer) => {
    const message: RTCAVMessage = JSON.parse(result.toString());
    for (const candidate of message.candidates) {
      // console.log('remote candidate', candidate);
      pc.addIceCandidate(candidate);
    }
  };

  (async () => {
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

  pc.onicecandidate = async (evt) => {
    if (!evt.candidate) {
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

  return pc;
}

async function startCameraRtc(mediaManager: MediaManager, device: ScryptedDevice & VideoCamera & RTCSignalingChannel) {
  const pc = new RTCPeerConnection();
  const gatheringPromise = new Promise(resolve => pc.onicegatheringstatechange = () => {
    if (pc.iceGatheringState === 'complete')
      resolve(undefined);
  });

  class SignalingSession implements RTCSignalingSession {
    async onIceCandidate(candidate: RTCIceCandidate) {
      await pc.addIceCandidate(candidate);
    }
    async createLocalDescription(type: 'offer' | 'answer', setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> {
      if (setup.datachannel)
        pc.createDataChannel(setup.datachannel.label, setup.datachannel.dict);
      // it's possible to do talkback to ring.
      let useAudioTransceiver = false;
      try {
        if (setup.audio?.direction === 'sendrecv') {
          // doing sendrecv on safari requires a mic be attached, or it fails to connect.
          const mic = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
          for (const track of mic.getTracks()) {
            pc.addTrack(track);
          }
        }
        else {
          useAudioTransceiver = true;
        }
      }
      catch (e) {
        useAudioTransceiver = true;
      }
      if (useAudioTransceiver)
        pc.addTransceiver("audio", setup.audio);
      pc.addTransceiver("video", setup.video);

      pc.onicecandidate = ev => {
        sendIceCandidate?.(ev.candidate as any);
      };

      const toDescription = (init: RTCSessionDescriptionInit) => {
        return {
          type: init.type,
          sdp: init.sdp,
        }
      }

      if (type === 'offer') {
        let offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        const set = pc.setLocalDescription(offer);
        if (sendIceCandidate)
          return toDescription(offer);
        await set;
        await gatheringPromise;
        offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: true,
        });
        return toDescription(offer);
      }
      else {
        let answer = await pc.createAnswer();
        const set = pc.setLocalDescription(answer);
        if (sendIceCandidate)
          return toDescription(answer);
        await set;
        await gatheringPromise;
        answer = pc.currentLocalDescription || answer;
        return toDescription(answer);
      }
    }
    async setRemoteDescription(description: RTCSessionDescription) {
      await pc.setRemoteDescription(description);
    }
  }

  device.startRTCSignalingSession(new SignalingSession());
  return pc;
}

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & VideoCamera & RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  let pc: RTCPeerConnection;

  if (device.interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
    pc = await startCameraRtc(mediaManager, device);
  }
  else {
    // todo: stop using the weird buffer convertor as a shim a signaling channel.
    pc = await startCameraLegacy(mediaManager, device);
  }

  try {
    pc.onconnectionstatechange = async () => {
      console.log(pc.connectionState);

      const stats = await pc.getStats()
      let selectedLocalCandidate
      for (const { type, state, localCandidateId } of stats.values())
        if (type === 'candidate-pair' && state === 'succeeded' && localCandidateId) {
          selectedLocalCandidate = localCandidateId
          break
        }
      const isLocal = !!selectedLocalCandidate && stats.get(selectedLocalCandidate)?.type === "local-candidate";
      console.log('isLocal', isLocal, stats.get(selectedLocalCandidate));
    };
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
