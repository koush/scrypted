import { AudioInfo, AudioStreamingCodecType, AudioStreamingSamplerate } from "../../hap";

export function createReturnAudioSdp(audioInfo: AudioInfo, srtp: Buffer = undefined, sdpIpVersion = 'IP4', address = '127.0.0.1', rtpPort = 0) {
    const isOpus = audioInfo.codec === AudioStreamingCodecType.OPUS;
    const { sample_rate } = audioInfo;

    /*
    https://wiki.multimedia.cx/index.php?title=MPEG-4_Audio

    5 bits: object type
    if (object type == 31)
        6 bits + 32: object type
    4 bits: frequency index
    if (frequency index == 15)
        24 bits: frequency
    4 bits: channel configuration
    var bits: AOT Specific Config
    */

    let csd = 'F8F0212C00BC00';
    /*
    11111000
    11110000 <-- 111 1000 0 = object-type-extended-last-3 frequency-index channel-config-first-1
    00100001
    00101100
    00000000
    10111100
    00000000

    frequency index corresponds to 8: 16000 Hz
    */

    /*
        There are 13 supported frequencies:

        0: 96000 Hz
        1: 88200 Hz
        2: 64000 Hz
        3: 48000 Hz
        4: 44100 Hz
        5: 32000 Hz
        6: 24000 Hz
        7: 22050 Hz
        8: 16000 Hz
        9: 12000 Hz
        10: 11025 Hz
        11: 8000 Hz
        12: 7350 Hz
        13: Reserved
        14: Reserved
        15: frequency is written explictly
    */

    let csdBuffer = Buffer.from(csd, 'hex');
    let b = csdBuffer[1];
    b &= 0b11100001;
    let fi = sample_rate === AudioStreamingSamplerate.KHZ_8 ? 11
        : sample_rate === AudioStreamingSamplerate.KHZ_24 ? 6 : 8;
    b |= (fi << 1);
    csdBuffer[1] = b;
    csd = csdBuffer.toString('hex').toUpperCase();

    // rewrite the frequency index to actual negotiated value.


    // Session description protocol message that FFmpeg will share with HomeKit.
    // SDP messages tell the other side of the connection what we're expecting to receive.
    //
    // Parameters are:
    // v             protocol version - always 0.
    // o             originator and session identifier.
    // s             session description.
    // c             connection information.
    // t             timestamps for the start and end of the session.
    // m             media type - audio, adhering to RTP/AVP, payload type 110.
    // b             bandwidth information - application specific, 24k.
    // a=rtpmap      payload type 110 corresponds to an MP4 stream.
    // a=fmtp        for payload type 110, use these format parameters.
    // a=crypto      crypto suite to use for this session.
    const sdpReturnAudio = [
        "v=0",
        "o=- 0 0 IN " + sdpIpVersion + " 127.0.0.1",
        "s=" + "HomeKit Audio Talkback",
        "c=IN " + sdpIpVersion + " " + address,
        "t=0 0",
        "m=audio " + rtpPort + " RTP/AVP 110",
        "b=AS:24",
        ...(isOpus
            ? [
                "a=rtpmap:110 opus/24000/2",
                "a=fmtp:101 minptime=10;useinbandfec=1",
            ]
            : [
                "a=rtpmap:110 MPEG4-GENERIC/16000/1",
                "a=fmtp:110 profile-level-id=1;mode=AAC-hbr;sizelength=13;indexlength=3;indexdeltalength=3; config=" + csd,
            ])
    ];

    if (srtp)
        sdpReturnAudio.push("a=crypto:1 AES_CM_128_HMAC_SHA1_80 inline:" + srtp.toString("base64"));

    return sdpReturnAudio.join('\n');
}
