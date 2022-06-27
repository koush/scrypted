import { BrowserSignalingSession } from "@scrypted/common/src/rtc-signaling";
import { MediaManager, MediaObject, RequestMediaStream, RequestRecordingStreamOptions, RTCSessionControl, RTCSignalingChannel, ScryptedDevice, ScryptedMimeTypes, VideoRecorder } from "@scrypted/types";

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  return streamMedia(device, getVideo);
}

export async function streamRecorder(mediaManager: MediaManager, device: ScryptedDevice & VideoRecorder, startTime: number, recordingStream: MediaObject, getVideo: () => HTMLVideoElement) {
  if (recordingStream) {
    const newStream = await device.getRecordingStream({
      startTime,
      container: 'rtsp',
    }, recordingStream);
    if (newStream) {
      if (newStream === recordingStream)
        return;
      console.warn('Received different stream from initial stream. Implementation is incorrect and should return null or undefined.');
    }
  }

  let requestMediaStream: RequestMediaStream;
  const rp = new Promise<MediaObject>(async (resolve) => {
    requestMediaStream = async (options) => {
      const ro: RequestRecordingStreamOptions = Object.assign({
        startTime,
        container: 'rtsp',
      } as RequestRecordingStreamOptions, options);
      recordingStream = await device.getRecordingStream(ro, recordingStream);
      resolve(recordingStream);
      return recordingStream;
    };
  });

  const mo = await mediaManager.createMediaObject(requestMediaStream, ScryptedMimeTypes.RequestMediaStream);
  const channel: RTCSignalingChannel = await mediaManager.convertMediaObject(mo, ScryptedMimeTypes.RTCSignalingChannel);

  const value = await streamMedia(channel, getVideo)
  recordingStream = await rp;

  return {
    recordingStream,
    ...value,
  };
}

export async function streamMedia(device: RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  const session = new BrowserSignalingSession();
  const pc = new Promise<RTCPeerConnection>(resolve => {
    session.pcDeferred.promise.then(pc => {
      pc.addEventListener('connectionstatechange', () => {
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
    });
  })

  const control: RTCSessionControl = await device.startRTCSignalingSession(session);
  const close = () => {
    control.endSession();
    session.close();
  };
  return { control, session, close };
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
