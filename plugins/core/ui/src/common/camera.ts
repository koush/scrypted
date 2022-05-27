import { BrowserSignalingSession } from "@scrypted/common/src/rtc-signaling";
import { RTCSessionControl } from "@scrypted/types";
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
  const session = new BrowserSignalingSession();
  const pc = new Promise<RTCPeerConnection>(resolve => {
    session.peerConnectionCreated = async (pc) => {
      pc.addEventListener('connectionstatechange', () => {
        if (pc.connectionState === 'connected') {
          control.startSession();
        }
        if (pc.iceConnectionState === 'disconnected'
          || pc.iceConnectionState === 'failed'
          || pc.iceConnectionState === 'closed') {
          control.endSession();
        }
      });
      pc.addEventListener('iceconnectionstatechange', () => {
        console.log('iceConnectionStateChange', pc.connectionState, pc.iceConnectionState);
        if (pc.iceConnectionState === 'disconnected'
          || pc.iceConnectionState === 'failed'
          || pc.iceConnectionState === 'closed') {
          control.endSession();
        }
      });

      pc.ontrack = ev => {
        const mediaStream = new MediaStream(
          pc.getReceivers().map((receiver) => receiver.track)
        );
        getVideo().srcObject = mediaStream;
        console.log('received track', ev.track);
      };
      resolve(pc);
    };
  })

  const control: RTCSessionControl = await device.startRTCSignalingSession(session);
  return pc;
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
