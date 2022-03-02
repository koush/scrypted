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

function getTrackId(track: string) {
    if (!track)
        return;
    const lines = track.split('\n').map(line => line.trim());
    const control = lines.find(line => line.startsWith('a=control:'));
    return control?.split('a=control:')?.[1];
}

export function parseTrackIds(sdp: string) {
    const tracks = sdp.split('m=');

    const audioTrack = tracks.find(track => track.startsWith('audio'));
    const videoTrack = tracks.find(track => track.startsWith('video'));
    return {
        audio: getTrackId(audioTrack),
        video: getTrackId(videoTrack),
    };
}
