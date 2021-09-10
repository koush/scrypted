import {ScryptedDevice, Camera, ScryptedMimeTypes, RTCAVMessage, MediaManager, VideoCamera} from '@scrypted/sdk/types';

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & VideoCamera, getVideo: () => any, createPeerConnection: (configuration: any) => RTCPeerConnection) {
    const videoStream = await device.getVideoStream();
    const offer = await mediaManager.convertMediaObjectToBuffer(
      videoStream,
      ScryptedMimeTypes.RTCAVOffer
    );
    const json = JSON.parse(offer.toString());
    const pc = createPeerConnection(json.configuration);
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
            console.log('remote candidate', candidate);
            pc.addIceCandidate(candidate);
          }
        };

        pc.onicecandidate = async (evt) => {
          if (!evt.candidate)
            return;
          console.log('local candidate', evt.candidate);
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

        (async() => {
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