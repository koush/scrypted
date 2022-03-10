export function replacePorts(sdp: string, audioPort: number, videoPort: number) {
    let outputSdp = sdp
        .replace(/c=IN .*/, `c=IN IP4 127.0.0.1`)
        .replace(/m=audio \d+/, `m=audio ${audioPort}`)
        .replace(/m=video \d+/, `m=video ${videoPort}`);
    return outputSdp;
}

export function addTrackControls(sdp: string) {
    let lines = sdp.split('\n').map(line => line.trim());
    lines = lines.filter(line => !line.includes('a=control:'));
    const vindex = lines.findIndex(line => line.startsWith('m=video'));
    if (vindex !== -1)
        lines.splice(vindex + 1, 0, 'a=control:trackID=video');
    const aindex = lines.findIndex(line => line.startsWith('m=audio'));
    if (aindex !== -1)
        lines.splice(aindex + 1, 0, 'a=control:trackID=audio');
    return lines.join('\r\n')
}

export function parsePayloadTypes(sdp: string) {
    const audioPayloadTypes = new Set<number>();
    const videoPayloadTypes = new Set<number>();
    const addPts = (set: Set<number>, pts: string[]) => {
        for (const pt of pts || []) {
            set.add(parseInt(pt));
        }
    };
    const audioPts = sdp.match(/m=audio.*/)?.[0];
    addPts(audioPayloadTypes, audioPts?.split(' ').slice(3));
    const videoPts = sdp.match(/m=video.*/)?.[0];
    addPts(videoPayloadTypes, videoPts?.split(' ').slice(3));
    return {
        audioPayloadTypes,
        videoPayloadTypes,
    }
}

export function findTrack(sdp: string, type: string, directions: TrackDirection[] = ['recvonly', 'sendrecv']) {
    const tracks = sdp.split('m=').filter(track => track.startsWith(type));

    for (const track of tracks) {
        const returnTrack = () => {
            const lines = track.split('\n').map(line => line.trim());
            const control = lines.find(line => line.startsWith('a=control:'));
            return {
                section: 'm=' + track,
                trackId: control?.split('a=control:')?.[1],
            };
        }

        for (const dir of directions) {
            if (track.includes(`a=${dir}`)) {
                return returnTrack();
            }
        }

        // some sdp do not advertise a media flow direction. i think recvonly is the default?
        if ((directions.includes('recvonly'))
            && !track.includes('sendonly')
            && !track.includes('inactive')) {
            return returnTrack();
        }
    }
}

type TrackDirection = 'sendonly' | 'sendrecv' | 'recvonly' | 'inactive';

export function parseTrackIds(sdp: string, directions: TrackDirection[] = ['recvonly', 'sendrecv']) {
    return {
        audio: findTrack(sdp, 'audio', directions)?.trackId,
        video: findTrack(sdp, 'video', directions)?.trackId,
    };
}
