import { BrowserSignalingSession, waitPeerIceConnectionClosed } from "@scrypted/common/src/rtc-signaling";
import { MediaManager, MediaObject, RequestMediaStream, RequestRecordingStreamOptions, RTCSessionControl, RTCSignalingChannel, ScryptedDevice, ScryptedMimeTypes, VideoRecorder } from "@scrypted/types";

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice & RTCSignalingChannel, getVideo: () => HTMLVideoElement) {
  const ret = await streamMedia(device);
  getVideo().srcObject = ret.mediaStream;
  return ret;
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

  const ret = await streamMedia(channel);
  getVideo().srcObject = ret.mediaStream;
  recordingStream = await rp;

  return {
    recordingStream,
    ...ret,
  };
}

export async function streamMedia(device: RTCSignalingChannel) {
  const session = new BrowserSignalingSession();
  const mediaStream = new MediaStream();
  session.onPeerConnection = async pc => {
    pc.ontrack = e => {
      console.log('add track', e.track);
      mediaStream.addTrack(e.track);
    }
  };
  const control: RTCSessionControl = await device.startRTCSignalingSession(session);
  session.pcDeferred.promise.then(pc => {
    pc.addEventListener('iceconnectionstatechange', () => {
      console.log('iceConnectionStateChange', pc.iceConnectionState);
      if (pc.iceConnectionState === 'disconnected'
        || pc.iceConnectionState === 'failed'
        || pc.iceConnectionState === 'closed') {
        control.endSession();
      }
    });
  });

  const close = () => {
    control.endSession();
    session.close();
  };
  return { control, session, close, mediaStream };
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
