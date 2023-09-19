import { H264Repacketizer, depacketizeStapA } from '../src/index';
import { H264_NAL_TYPE_IDR, H264_NAL_TYPE_PPS, H264_NAL_TYPE_SEI, H264_NAL_TYPE_SPS, H264_NAL_TYPE_STAP_A, RtspServer, getNaluTypesInNalu } from '../../../common/src/rtsp-server';
import fs from 'fs';

import { getNvrSessionStream } from '../../../../nvr/nvr-plugin/src/session-stream';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { RtpPacket } from '../../../external/werift/packages/rtp/src/rtp/rtp';

function parse(parameters: string) {
    const spspps = parameters.split(',');
    // empty sprop-parameter-sets is apparently a thing:
    //     a=fmtp:96 profile-level-id=420029; packetization-mode=1; sprop-parameter-sets=
    if (spspps?.length !== 2) {
        return {
            sps: undefined,
            pps: undefined,
        };
    }
    const [sps, pps] = spspps;

    return {
        sps: Buffer.from(sps, 'base64'),
        pps: Buffer.from(pps, 'base64'),
    }
}

async function main() {
    const spspps = parse('Z2QAM6wVFKAoALWQ,aO48sA==');
    //                    Z2QAM6wVFKAoALWQ
    //                    Z00AMpY1QEABg03BQEFQAAADABAAAAMDKEA=


    const repacketizer = new H264Repacketizer(console, 1300, undefined);

    const stream = fs.createReadStream('/Users/koush/Downloads/rtsp/1692537093973.rtsp', {
        start: 0,
        highWaterMark: 800000,
    });

    let rtspParser = new RtspServer(stream as any, '');
    rtspParser.setupTracks = {
        '0': {
            codec: '0',
            protocol: 'tcp',
            control: '',
            destination: 0,
        },
        '2': {
            codec: '2',
            protocol: 'tcp',
            control: '',
            destination: 2,
        },
    }
    for await (const rtspSample of rtspParser.handleRecord()) {
        if (rtspSample.type !== '0')
            continue;
        const rtp = RtpPacket.deSerialize(rtspSample.packet);
        const nalus = getNaluTypesInNalu(rtp.payload);
        if (nalus.has(H264_NAL_TYPE_SEI)) {
            console.warn('SEI', rtp.payload)
        }
        if (nalus.has(H264_NAL_TYPE_SPS)) {
            console.warn('SPS', rtp.payload, spspps.sps)
        }
        if (nalus.has(H264_NAL_TYPE_PPS)) {
            console.warn('PPS', rtp.payload, spspps.sps)
        }
        if (nalus.has(H264_NAL_TYPE_STAP_A)) {
            const parts = depacketizeStapA(rtp.payload);
            console.log('stapa', parts);
            for (const part of parts) {

            }
        }

        if (nalus.has(H264_NAL_TYPE_IDR)) {
            const h264Packetizer = new H264Repacketizer(console, 65535, spspps as any);
            // offset the stapa packet by -1 so the sequence numbers can be reused.
            h264Packetizer.extraPackets = -1;
            const stapas: RtpPacket[] = [];
            const idr = RtpPacket.deSerialize(rtspSample.packet);
            h264Packetizer.maybeSendStapACodecInfo(idr, stapas);
            if (stapas.length === 1) {
                const stapa = stapas[0].serialize();
                // console.log(stapa);
            }
        }
    }
}
main();