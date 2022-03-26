import os from 'os';

const PI_MODEL_NO = [
    // https://www.raspberrypi.org/documentation/hardware/raspberrypi/
    'BCM2708',
    'BCM2709',
    'BCM2710',
    'BCM2835', // Raspberry Pi 1 and Zero
    'BCM2836', // Raspberry Pi 2
    'BCM2837', // Raspberry Pi 3 (and later Raspberry Pi 2)
    'BCM2837B0', // Raspberry Pi 3B+ and 3A+
    'BCM2711' // Raspberry Pi 4B
];

function isPi(model: string) {
    return PI_MODEL_NO.indexOf(model) > -1;
}

export function isRaspberryPi() {
    let cpuInfo: string;
    try {
        cpuInfo = require('realfs').readFileSync('/proc/cpuinfo', { encoding: 'utf8' });
    }
    catch (e) {
        // if this fails, this is probably not a pi
        return false;
    }

    const model = cpuInfo
        .split('\n')
        .map(line => line.replace(/\t/g, ''))
        .filter(line => line.length > 0)
        .map(line => line.split(':'))
        .map(pair => pair.map(entry => entry.trim()))
        .filter(pair => pair[0] === 'Hardware')

    if (!model || model.length == 0) {
        return false;
    }

    const number = model[0][1];
    return isPi(number);
}

export type CodecArgs = { [type: string]: string[] };

const V4L2 = 'Video4Linux (Docker compatible)';

export function getH264DecoderArgs(): CodecArgs {
    if (isRaspberryPi()) {
        const ret: CodecArgs = {};
        // ret['Raspberry Pi MMAL'] = ['-c:v', 'h264_mmal'];
        // ret[V4L2] = ['-c:v', 'h264_v4l2m2m'];
        return ret;
    }
    else if (os.platform() === 'darwin') {
        return {
            // specifying videotoolbox seems to cause issues with multiple? unclear why.
            // the ffmpeg process tears down, yet it seems like something is not disposed.
            'VideoToolbox': ['-hwaccel', 'auto']
        }
    }

    const ret: CodecArgs = {
        'Nvidia CUDA': [
            '-vsync', '0', '–hwaccel', 'cuda', '-hwaccel_output_format', 'cuda',
        ],
        'Nvidia CUVID:': [
            '-vsync', '0', '–hwaccel', 'cuvid', '-c:v', 'h264_cuvid',
        ],
    };

    if (isRaspberryPi()) {
        ret['Raspberry Pi'] = ['-c:v', 'h264_mmal'];
        ret[V4L2] = ['-c:v', 'h264_v4l2m2m'];
    }
    else if (os.platform() === 'linux') {
        ret[V4L2] = ['-c:v', 'h264_v4l2m2m'];
    }
    else if (os.platform() === 'win32') {
        ret['Intel QuickSync'] = ['-c:v', 'h264_qsv'];
    }
    else {
        return {};
    }

    return ret;
}

export function getH264EncoderArgs() {
    const encoders: { [type: string]: string } = {};

    encoders['Copy Video, Transcode Audio'] = 'copy';

    if (isRaspberryPi()) {
        // encoders['Raspberry Pi OMX'] = 'h264_omx';
        // encoders[V4L2] = 'h264_v4l2m2m';
    }
    else if (os.platform() === 'darwin') {
        encoders['VideoToolbox'] = 'h264_videotoolbox';
    }
    else if (os.platform() === 'win32') {
        // h264_amf h264_nvenc h264_qsv
        encoders['Intel QuickSync'] = 'h264_qsv';
        encoders['AMD'] = 'h264_amf';
        encoders['Nvidia'] = 'h264_nvenc';
    }
    else if (os.platform() === 'linux') {
        // h264_v4l2m2m h264_vaapi nvenc_h264
        encoders['V4L2'] = 'h264_v4l2m2m';
        encoders['VAAPI'] = 'h264_vaapi';
        encoders['Nvidia'] = 'nvenc_h264';
    }
    else {
        return {};
    }

    const encoderArgs: CodecArgs = {};
    for (const [name, encoder] of Object.entries(encoders)) {
        encoderArgs[name] = [
            '-c:v',
            encoder,
        ]
    }

    if (isRaspberryPi()) {
        encoderArgs['Raspberry Pi'] = [
            '-pix_fmt', 'yuv420p', '-c:v', 'h264_v4l2m2m',
        ]
    }
    return encoderArgs;
}
