import child_process from 'child_process';
import { listenZeroSingleClient } from "./listen-cluster";
import { ffmpegLogInitialOutput } from "./media-helpers";
import sdk, { FFMpegInput, ScryptedMimeTypes, MediaObject, RTCAVSignalingSetup, RTCSignalingChannel, RTCSignalingClientOptions, RTCSignalingSession, ScryptedDevice, ScryptedInterface, VideoCamera, RTCSignalingClientSession } from "@scrypted/sdk";
import { RpcPeer } from "../../server/src/rpc";

const { mediaManager } = sdk;

const configuration: RTCConfiguration = {
  iceServers: [
    {
      urls: ["turn:turn0.clockworkmod.com", "turn:n0.clockworkmod.com", "turn:n1.clockworkmod.com"],
      username: "foo",
      credential: "bar",
    },
  ],
};

export function isPeerConnectionAlive(pc: RTCPeerConnection) {
  if (pc.iceConnectionState === 'disconnected'
    || pc.iceConnectionState === 'failed'
    || pc.iceConnectionState === 'closed')
    return false;
  if (pc.connectionState === 'closed'
    || pc.connectionState === 'disconnected'
    || pc.connectionState === 'failed')
    return false;
  return true;
}

let wrtc: any;
function initalizeWebRtc() {
  wrtc = require('@koush/wrtc');
  Object.assign(global, wrtc);
}

export async function startRTCPeerConnectionFFmpegInput(ffInput: FFMpegInput, options?: {
  maxWidth: number,
}): Promise<RTCPeerConnection> {
  initalizeWebRtc();

  const pc = new RTCPeerConnection(configuration);

  const { RTCVideoSource, RTCAudioSource } = wrtc.nonstandard;

  const videoSource = new RTCVideoSource();
  pc.addTrack(videoSource.createTrack());

  let audioPort: number;

  const audioSource = new RTCAudioSource();
  pc.addTrack(audioSource.createTrack());

  const audioServer = await listenZeroSingleClient();
  audioServer.clientPromise.then(async (socket) => {
    const { sample_rate, channels } = await sampleInfo;
    const bitsPerSample = 16;
    const channelCount = channels[1] === 'stereo' ? 2 : 1;
    const sampleRate = parseInt(sample_rate[1]);

    const toRead = sampleRate / 100 * channelCount * 2;
    socket.on('readable', () => {
      while (true) {
        const buffer: Buffer = socket.read(toRead);
        if (!buffer)
          return;

        const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + toRead)
        const samples = new Int16Array(ab);  // 10 ms of 16-bit mono audio

        const data = {
          samples,
          sampleRate,
          bitsPerSample,
          channelCount,
        };
        try {
          audioSource.onData(data);
        }
        catch (e) {
          cp.kill();
          console.error(e);
        }
      }
    });
  });
  audioPort = audioServer.port;

  const videoServer = await listenZeroSingleClient();
  videoServer.clientPromise.then(async (socket) => {
    const res = await resolution;
    const width = parseInt(res[2]);
    const height = parseInt(res[3]);
    const toRead = parseInt(res[2]) * parseInt(res[3]) * 1.5;
    socket.on('readable', () => {
      while (true) {
        const buffer: Buffer = socket.read(toRead);
        if (!buffer)
          return;
        const data = new Uint8ClampedArray(buffer);
        const frame = { width, height, data };
        try {
          videoSource.onFrame(frame)
        }
        catch (e) {
          cp.kill();
          console.error(e);
        }
      }
    });
  })

  const args = [
    '-hide_banner',
    // don't think this is actually necessary but whatever.
    '-y',
  ];

  args.push(...ffInput.inputArguments);

  // create a dummy audio track if none actually exists.
  // this track will only be used if no audio track is available.
  // https://stackoverflow.com/questions/37862432/ffmpeg-output-silent-audio-track-if-source-has-no-audio-or-audio-is-shorter-th
  args.push('-f', 'lavfi', '-i', 'anullsrc=cl=1', '-shortest');

  args.push('-vn');
  args.push('-acodec', 'pcm_s16le');
  args.push('-f', 's16le');
  args.push(`tcp://127.0.0.1:${audioPort}`);

  args.push('-an');
  // chromecast seems to crap out on higher than 15fps??? is there
  // some webrtc video negotiation that is failing here?
  args.push('-r', '15');
  args.push('-vcodec', 'rawvideo');
  args.push('-pix_fmt', 'yuv420p');
  if (options?.maxWidth) {
    // args.push('-vf', `scale=${options.maxWidth}:-1`);
    args.push('-vf', 'scale=w=iw/2:h=ih/2');
  }
  args.push('-f', 'rawvideo');
  args.push(`tcp://127.0.0.1:${videoServer.port}`);

  console.log(ffInput);
  console.log(args);

  const cp = child_process.spawn(await mediaManager.getFFmpegPath(), args, {
    // DO NOT IGNORE STDIO, NEED THE DATA FOR RESOLUTION PARSING, ETC.
  });
  ffmpegLogInitialOutput(console, cp);
  cp.on('error', e => console.error('ffmpeg error', e));

  const closePeerConnection = () => {
    // causes wrtc crash???
    // pc.close();
  };

  cp.on('exit', closePeerConnection);

  let outputSeen = false;
  const resolution = new Promise<Array<string>>(resolve => {
    cp.stdout.on('data', data => {
      const stdout = data.toString();
      outputSeen = outputSeen || stdout.includes('Output #0');
      const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
      if (res && outputSeen)
        resolve(res);
    });
    cp.stderr.on('data', data => {
      const stdout = data.toString();
      outputSeen = outputSeen || stdout.includes('Output #0');
      const res = /(([0-9]{2,5})x([0-9]{2,5}))/.exec(stdout);
      if (res && outputSeen)
        resolve(res);
    });
  });

  interface SampleInfo {
    sample_rate: string[];
    channels: string[];
  }

  const sampleInfo = new Promise<SampleInfo>(resolve => {
    const parser = (data: Buffer) => {
      const stdout = data.toString();
      const sample_rate = /([0-9]+) Hz/i.exec(stdout)
      const channels = /Audio:.* (stereo|mono|1 channels)/.exec(stdout)
      if (sample_rate && channels) {
        resolve({
          sample_rate, channels,
        });
      }
    };
    cp.stdout.on('data', parser);
    cp.stderr.on('data', parser);
  });

  const cleanup = () => {
    closePeerConnection();
    cp?.kill();
    setTimeout(() => cp?.kill('SIGKILL'), 1000);
  }

  const checkConn = () => {
    if (!isPeerConnectionAlive(pc)) {
      cleanup();
    }
  }

  pc.addEventListener('connectionstatechange', checkConn);
  pc.addEventListener('iceconnectionstatechange', checkConn);

  setTimeout(() => {
    if (pc.connectionState !== 'connected') {
      closePeerConnection();
      cp.kill();
    }
  }, 60000);
  return pc;
}

export async function startRTCPeerConnection(console: Console, mediaObject: MediaObject, session: RTCSignalingSession, options?: RTCSignalingClientOptions & {
  maxWidth: number,
}) {
  const buffer = await mediaManager.convertMediaObjectToBuffer(mediaObject, ScryptedMimeTypes.FFmpegInput);
  const ffInput = JSON.parse(buffer.toString());

  const pc = await startRTCPeerConnectionFFmpegInput(ffInput, options);

  try {
    pc.onicecandidate = ev => {
      if (ev.candidate) {
        console.log('local candidate', ev.candidate);
        session.addIceCandidate(JSON.parse(JSON.stringify(ev.candidate)));
      }
    }

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const setup: RTCAVSignalingSetup = {
      type: 'offer',
      audio: {
        direction: 'recvonly',
      },
      video: {
        direction: 'recvonly',
      }
    };
    await session.setRemoteDescription(offer, setup);

    const answer = await session.createLocalDescription('answer', setup, async (candidate) => {
      console.log('remote candidate', candidate);
      pc.addIceCandidate(candidate);
    });

    await pc.setRemoteDescription(answer);
    return pc;
  }
  catch (e) {
    pc.close();
    throw e;
  }
}

export function startRTCPeerConnectionForBrowser(console: Console, mediaObject: MediaObject, session: RTCSignalingSession, options?: RTCSignalingClientOptions) {
  return startRTCPeerConnection(console, mediaObject, session, Object.assign({
    maxWidth: 960,
  }, options || {}));
}

export async function createBrowserSignalingSession(ws: WebSocket) {
  const peer = new RpcPeer("google-home", "cast-receiver", (message, reject) => {
    const json = JSON.stringify(message);
    try {
      ws.send(json);
    }
    catch (e) {
      reject?.(e);
    }
  });
  ws.onmessage = message => {
    const json = JSON.parse(message.data);
    peer.handleMessage(json);
  };

  const session: RTCSignalingClientSession = await peer.getParam('session');
  return session;
}

export async function startBrowserRTCSignaling(camera: ScryptedDevice & RTCSignalingChannel & VideoCamera, ws: WebSocket, console: Console) {
  try {
    const session = await createBrowserSignalingSession(ws);
    const options = await session.getOptions();

    if (camera.interfaces.includes(ScryptedInterface.RTCSignalingChannel)) {
      camera.startRTCSignalingSession(session, options);
    }
    else {
      return startRTCPeerConnectionForBrowser(console, await camera.getVideoStream(), session, options);
    }
  }
  catch (e) {
    console.error("error negotiating browser RTCC signaling", e);
    ws.close();
    throw e;
  }
}
