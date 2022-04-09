import { BrowserSignalingSession } from "@scrypted/common/src/rtc-signaling";
import { MediaManager, MediaObject, RTCSignalingChannel, ScryptedDevice, ScryptedMimeTypes, VideoRecorder } from "@scrypted/types";

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  return streamMedia(device, getVideo);
}

export async function streamRecorder(mediaManager: MediaManager, device: ScryptedDevice & VideoRecorder, startTime: number, getVideo: () => HTMLVideoElement) {
  const mo = await device.getRecordingStream({
    startTime,
  });

  const channel: RTCSignalingChannel = await mediaManager.convertMediaObject(mo, ScryptedMimeTypes.RTCSignalingChannel);
  return streamMedia(channel, getVideo);
}

export async function streamMedia(device: RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  return new Promise(resolve => {
    const session = new BrowserSignalingSession(async (pc) => {

      pc.ontrack = ev => {
        const mediaStream = new MediaStream(
          pc.getReceivers().map((receiver) => receiver.track)
        );
        getVideo().srcObject = mediaStream;
        const remoteAudio = document.createElement("audio");
        remoteAudio.srcObject = mediaStream;
        remoteAudio.play();
        console.log('received track', ev.track);
      };

      resolve(pc);
    });

    device.startRTCSignalingSession(session);
  });
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
