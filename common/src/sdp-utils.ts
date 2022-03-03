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

export function findTrack(sdp: string, type: string, directions: TrackDirection[] = ['recvonly']) {
    const tracks = sdp.split('m=').filter(track => track.startsWith(type));
    for (const track of tracks) {
        for (const dir of directions) {
            if (track.includes(`a=${dir}`)) {
                const lines = track.split('\n').map(line => line.trim());
                const control = lines.find(line => line.startsWith('a=control:'));
                return {
                    section: 'm=' + track,
                    trackId: control?.split('a=control:')?.[1],
                };
            }
        }
    }
}

type TrackDirection = 'sendonly' | 'sendrecv' | 'recvonly';

export function parseTrackIds(sdp: string, directions: TrackDirection[] = ['recvonly', 'sendrecv']) {
    return {
        audio: findTrack(sdp, 'audio', directions)?.trackId,
        video: findTrack(sdp, 'video', directions)?.trackId,
    };
}
