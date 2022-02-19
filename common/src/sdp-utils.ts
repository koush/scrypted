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
