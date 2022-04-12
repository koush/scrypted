// todo: move this to ring.
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
    let trackCount = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.startsWith('m='))
            continue;
        lines.splice(i + 1, 0, 'a=control:trackID=' + trackCount);
        trackCount++;
    }
    return lines.join('\r\n')
}

// todo: move this to webrtc
// this is an sdp corresponding to what is requested from webrtc.
// h264 baseline and opus are required codecs that all webrtc implementations must provide.
export function createSdpInput(audioPort: number, videoPort: number, sdp: string) {
    // replace all IPs
    let outputSdp = sdp
        .replace(/c=IN .*/, `c=IN IP4 127.0.0.1`)
        .replace(/m=audio \d+/, `m=audio ${audioPort}`)
        .replace(/m=video \d+/, `m=video ${videoPort}`);

    // filter all ice and rtcp mux info
    let lines = outputSdp.split('\n').map(line => line.trim());
    lines = lines
        .filter(line => !line.includes('a=rtcp-mux'))
        .filter(line => !line.includes('a=candidate'))
        .filter(line => !line.includes('a=ice'));

    outputSdp = lines.join('\r\n');

    outputSdp = addTrackControls(outputSdp);

    // only include the m sections.
    outputSdp = outputSdp.split('m=')
        .slice(1)
        .map(line => 'm=' + line)
        .join('');
    return outputSdp;
}

// todo: move this to webrtc
export function findFmtp(sdp: string, codec: string) {
    let lines = sdp.split('\n').map(line => line.trim());

    const re = new RegExp(`a=rtpmap:(\\d+) ${codec}`);
    const rtpmaps = lines.map(line => line.match(re)).filter(match => !!match);
    return rtpmaps.map(match => {
        const payloadType = parseInt(match[1]);
        const fmtpPrefix = `a=fmtp:${payloadType} `;
        const fmtp = lines.find(line => line.startsWith(fmtpPrefix))?.substring(fmtpPrefix.length);
        return {
            payloadType,
            fmtp,
        }
    })
}

function getSections(sdp: string) {
    const sections = ('\n' + sdp).split('\nm=');
    return sections;
}

export function findTrackByType(sdp: string, type: string, directions: TrackDirection[] = ['recvonly', 'sendrecv']) {
    const sections = getSections(sdp).filter(track => track.startsWith(type));

    for (const section of sections) {
        const returnTrack = () => {
            const lines = section.split('\n').map(line => line.trim());
            const controlString = 'a=control:';
            const control = lines.find(line => line.startsWith(controlString));
            return {
                section: 'm=' + section,
                trackId: control.substring(controlString.length),
            };
        }

        for (const dir of directions) {
            if (section.includes(`a=${dir}`)) {
                return returnTrack();
            }
        }

        // some sdp do not advertise a media flow direction. i think recvonly is the default?
        if ((directions.includes('recvonly'))
            && !section.includes('sendonly')
            && !section.includes('inactive')) {
            return returnTrack();
        }
    }
}

type TrackDirection = 'sendonly' | 'sendrecv' | 'recvonly' | 'inactive';

export function findTracksByType(sdp: string, directions: TrackDirection[] = ['recvonly', 'sendrecv']) {
    return {
        audio: findTrackByType(sdp, 'audio', directions)?.trackId,
        video: findTrackByType(sdp, 'video', directions)?.trackId,
    };
}

export function parseMLinePayloadTypes(mline: string) {
    const payloadTypes: number[] = [];
    for (const pt of mline.split(' ').slice(3) || []) {
        payloadTypes.push(parseInt(pt));
    }
    return payloadTypes;
}

export function parseMLine(mline: string) {
    // 'm=audio 0 RTP/AVP 96'
    const type = mline.split(' ')[0].substring(2);
    return {
        type,
        payloadTypes: parseMLinePayloadTypes(mline),
    }
}

const afmtp = 'a=fmtp';
export function parseFmtp(msection: string[]) {
    return msection.filter(line => line.startsWith(afmtp))
        .map(fmtpLine => {
            const firstSpace = fmtpLine.indexOf(' ');
            if (firstSpace === -1)
                return;
            const fmtp = fmtpLine.substring(0, firstSpace);
            const paramLine = fmtpLine.substring(firstSpace + 1);
            const payloadType = parseInt(fmtp.split(':')[1]);

            if (!fmtp || !paramLine || payloadType === NaN) {
                return;
            }

            const parameters: {
                [key: string]: string;
            } = {};

            paramLine.split(';').map(param => param.trim()).forEach(param => {
                const [key, ...value] = param.split('=');
                parameters[key] = value.join('=');
            });
            return {
                payloadType,
                parameters,
            }
        })
        .filter(fmtp => !!fmtp);
}

const acontrol = 'a=control:';
const artpmap = 'a=rtpmap:';
export function parseMSection(msection: string[]) {
    const control = msection.find(line => line.startsWith(acontrol))?.substring(acontrol.length);
    const rtpmap = msection.find(line => line.startsWith(artpmap))?.toLowerCase();

    let codec: string;
    if (rtpmap?.includes('mpeg4')) {
        codec = 'aac';
    }
    else if (rtpmap?.includes('opus')) {
        codec = 'opus';
    }
    else if (rtpmap?.includes('pcm')) {
        codec = 'pcm';
    }
    else if (rtpmap?.includes('h264')) {
        codec = 'h264';
    }

    let direction: string;
    for (const checkDirection of ['sendonly' , 'sendrecv', 'recvonly' , 'inactive']) {
        const found = msection.find(line => line === 'a=' + checkDirection);
        if (found) {
            direction = checkDirection;
            break;
        }
    }

    return {
        ...parseMLine(msection[0]),
        fmtp: parseFmtp(msection),
        lines: msection,
        contents: msection.join('\r\n'),
        control,
        codec,
        direction,
    }
}

export function parseSdp(sdp: string) {
    const lines = sdp.split('\n').map(line => line.trim());
    const header: string[] = [];
    const msections: string[][] = [];
    let msection: string[];

    for (const line of lines) {
        if (line.startsWith('m=')) {
            if (msection) {
                msections.push(msection);
            }
            msection = [];
        }

        if (msection) {
            msection.push(line);
        }
        else {
            header.push(line);
        }
    }

    if (msection)
        msections.push(msection);

    const ret = {
        header: {
            lines: header,
            contents: header.join('\r\n'),
        },
        msections: msections.map(parseMSection),
        toSdp: () => {
            return [...ret.header.lines, ...ret.msections.map(msection => msection.lines).flat()].join('\r\n');
        }
    }

    return ret;
}
