import { ScryptedDevice, MediaManager, MediaObject } from '@scrypted/types';
import { BrowserSignalingSession } from "@scrypted/common/src/rtc-signaling";
import eio from "engine.io-client";
import { RpcPeer } from '../../../../../server/src/rpc';

export async function streamCamera(mediaManager: MediaManager, device: ScryptedDevice, getVideo: () => HTMLVideoElement) {
  const pluginId = '@scrypted/core';
  const endpointPath = `/endpoint/${pluginId}`
  const options: any = {
    path: `${endpointPath}/engine.io/videocamera/`,
    query: {
      deviceId: device.id,
    },
    rejectUnauthorized: false,
  };
  const rootLocation = `${window.location.protocol}//${window.location.host}`;
  const socket = eio(rootLocation, options);

  return streamMedia(socket, getVideo);
}

export async function streamRecorder(mediaManager: MediaManager, device: ScryptedDevice, startTime: number, getVideo: () => HTMLVideoElement) {
  const pluginId = '@scrypted/core';
  const endpointPath = `/endpoint/${pluginId}`
  const options: any = {
    path: `${endpointPath}/engine.io/videorecorder/`,
    query: {
      deviceId: device.id,
      startTime,
    },
    rejectUnauthorized: false,
  };
  const rootLocation = `${window.location.protocol}//${window.location.host}`;
  const socket = eio(rootLocation, options);

  return streamMedia(socket, getVideo);
}

export async function streamMedia(socket: eio.Socket, getVideo: () => HTMLVideoElement) {
  const rpcPeer = new RpcPeer('cast-receiver', 'scrypted-server', (message, reject) => {
    try {
      socket.send(JSON.stringify(message));
    }
    catch (e) {
      reject?.(e);
    }
  });
  socket.on('message', data => {
    rpcPeer.handleMessage(JSON.parse(data.toString()));
  });

  const pc = new RTCPeerConnection();

  const session = new BrowserSignalingSession(pc, () => socket.close());
  rpcPeer.params['session'] = session;
  rpcPeer.params['options'] = session.options;

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

  pc.addEventListener('connectionstatechange', () => {
    if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected' || pc.connectionState === 'failed')
      socket.close();
  });

  pc.addEventListener('iceconnectionstatechange', () => {
    if (pc.iceConnectionState === 'closed' || pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')
      socket.close();
  });

  return pc;
}

export async function createBlobUrl(mediaManager: MediaManager, mediaObject: MediaObject): Promise<string> {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, 'image/*');
  const blob = new Blob([buffer]);
  return URL.createObjectURL(blob);
}
