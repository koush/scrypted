import {ScryptedDevice, Camera, ScryptedMimeTypes, RTCAVMessage, MediaManager, VideoCamera} from '@scrypted/sdk/types';

async function sleep(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

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
        const answerObject: RTCAVMessage = {
          id: json.id,
          candidates: [],
          description: null,
          configuration: json.configuration,
        };
        pc.onicecandidate = async (evt) => {
          console.log(evt.candidate);
          answerObject.candidates.push(evt.candidate);
        };
        await pc.setRemoteDescription(json.description);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        answerObject.description = answer;
    
        await sleep(5000);
        console.log(answerObject);
        const mo = await mediaManager.createMediaObject(
          Buffer.from(JSON.stringify(answerObject)),
          ScryptedMimeTypes.RTCAVAnswer
        );
        await mediaManager.convertMediaObjectToBuffer(
          mo,
          ScryptedMimeTypes.RTCAVOffer
        );
        console.log("done av offer");
    
        return pc;
    }
    catch (e) {
        pc.close();
        throw e;
    }
}