import child_process from 'child_process';
import fs from 'fs';
import path from 'path';
import { listenSingleRtspClient } from '../../../common/src/rtsp-server';
import { parseSdp } from '../../../common/src/sdp-utils';
import { once } from 'events';

export async function convertRtspToMp4(rtspFile: string, sessionFile?: string) {
    // rtsp file will be in roughly:
    // /nvr/scrypted-[id]/[session-timestamp]/[hour-timestamp]/[segment-timestamp].rtsp

    // sdp can be found in
    // /nvr/scrypted-[id]/[session-timestamp]/session.json
    // or legacy:
    // /nvr/scrypted-[id]/[session-timestamp]/session.sdp

    const sessionDir = path.dirname(path.dirname(rtspFile));
    let sdp: string;
    let sessionJson = path.join(sessionDir, 'session.json');
    if (!fs.existsSync(sessionJson) && sessionFile)
        sessionJson = sessionFile.endsWith('.json') && sessionFile;

    let sessionSdp = path.join(sessionDir, 'session.sdp');
    if (!fs.existsSync(sessionSdp) && sessionFile)
        sessionSdp = sessionFile.endsWith('.sdp') && sessionFile;

    if (fs.existsSync(sessionJson))  {
        sdp = JSON.parse(fs.readFileSync(sessionJson).toString()).sdp;
    }
    else if (fs.existsSync(sessionSdp)) {
        sdp = fs.readFileSync(sessionSdp).toString();
    }
    else {
        console.error('Could not find session sdp. Ensure the rtsp directory structure is intact or specify the path to the session file.');
        console.error();
        printRtspUsage();
        process.exit(1);
    }

    const parsedSdp = parseSdp(sdp);
    const hasAudio = parsedSdp.msections.some(msection => msection.type === 'audio');
    const rtspContents = fs.readFileSync(rtspFile);

    const clientPromise = await listenSingleRtspClient();
    clientPromise.rtspServerPromise.then(async rtspServer => {
        rtspServer.sdp = sdp;
        await rtspServer.handlePlayback();
        console.log('playing')
        rtspServer.client.write(rtspContents);
        rtspServer.client.end();
    });

    const mp4 = rtspFile + '.mp4';

    const cp = child_process.spawn('ffmpeg', [
        '-y',
        '-i', clientPromise.url,
        '-vcodec', 'copy',
        ...(hasAudio ? ['-acodec', 'aac'] : []),
        mp4,
    ], {
        stdio: 'inherit',
    });

    await once(cp, 'exit');

    console.log('mp4 written to:', mp4);
}

export function printRtspUsage() {
    console.log('usage: npx rtsp /path/to/nvr/file.rtsp [/path/to/nvr/session.json | /path/to/nvr/session.sdp]');
}
