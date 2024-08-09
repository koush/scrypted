import { MediaStreamConfiguration, MediaStreamDestination, MediaStreamOptions, VideoStreamConfiguration } from "@scrypted/sdk";
import { OnvifCameraAPI } from "./onvif-api";
import { UrlMediaStreamOptions } from "../../ffmpeg-camera/src/common";

export function computeInterval(fps: number, govLength: number) {
    if (!fps || !govLength)
        return;
    return govLength / fps * 1000;
}

const MEGABIT = 1024 * 1000;

function getBitrateForResolution(resolution: number) {
    if (resolution >= 3840 * 2160)
        return 8 * MEGABIT;
    if (resolution >= 2688 * 1520)
        return 3 * MEGABIT;
    if (resolution >= 1920 * 1080)
        return 2 * MEGABIT;
    if (resolution >= 1280 * 720)
        return MEGABIT;
    if (resolution >= 640 * 480)
        return MEGABIT / 2;
    return MEGABIT / 4;
}

const onvifToFfmpegVideoCodecMap = {
    'h264': 'h264',
    'h265': 'h265',
    'hevc': 'h265',
};

const onvifToFfmpegAudioCodecMap = {
    'mp4a': 'aac',
    'aac': 'aac',
    'PCMU': 'pcm_mulaw',
    'PCMA': 'pcm_alaw',
};

export function fromOnvifAudioCodec(codec: string) {
    codec = codec?.toLowerCase();
    return onvifToFfmpegAudioCodecMap[codec] || codec;
}

export function fromOnvifVideoCodec(codec: string) {
    codec = codec?.toLowerCase();
    return onvifToFfmpegVideoCodecMap[codec] || codec;
}

export function toOnvifAudioCodec(codec: string) {
    for (const [key, value] of Object.entries(onvifToFfmpegAudioCodecMap)) {
        if (value === codec)
            return key;
    }
    return codec;
}

export function toOnvifVideoCodec(codec: string) {
    for (const [key, value] of Object.entries(onvifToFfmpegVideoCodecMap)) {
        if (value === codec)
            return key;
    }
    return codec;
}

export function computeBitrate(bitrate: number) {
    if (!bitrate)
        return;
    return bitrate * 1000;
}

export async function autoconfigureCodecs(console: Console, client: OnvifCameraAPI) {
    const codecs = await getCodecs(console, client);
    const configurable: MediaStreamConfiguration[] = [];
    for (const codec of codecs) {
        const config = await configureCodecs(console, client, {
            id: codec.id,
        });
        configurable.push(config);
    }

    const used: MediaStreamConfiguration[] = [];

    for (const destination of ['local', 'remote', 'low-resolution'] as MediaStreamDestination[]) {
        // find stream with the highest configurable resolution.
        let highest: [MediaStreamConfiguration, number] = [undefined, 0];
        for (const codec of configurable) {
            if (used.includes(codec))
                continue;
            for (const resolution of codec.video.resolutions) {
                if (resolution[0] * resolution[1] > highest[1]) {
                    highest = [codec, resolution[0] * resolution[1]];
                }
            }
        }

        const config = highest[0];
        if (!config)
            break;

        used.push(config);
    }

    const findResolutionTarget = (config: MediaStreamConfiguration, width: number, height: number) => {
        let diff = 999999999;
        let ret: [number, number];

        for (const res of config.video.resolutions) {
            const d = Math.abs(res[0] - width) + Math.abs(res[1] - height);
            if (d < diff) {
                diff = d;
                ret = res;
            }
        }

        return ret;
    }

    // find the highest resolution
    const l = used[0];
    const resolution = findResolutionTarget(l, 8192, 8192);

    // get the fps of 20 or highest available
    let fps = Math.min(20, Math.max(...l.video.fpsRange));

    await configureCodecs(console, client, {
        id: l.id,
        video: {
            width: resolution[0],
            height: resolution[1],
            bitrateControl: 'variable',
            codec: 'h264',
            bitrate: getBitrateForResolution(resolution[0] * resolution[1]),
            fps,
            keyframeInterval: fps * 4,
            quality: 5,
            profile: 'main',
        },
    });

    if (used.length === 3) {
        // find remote and low
        const r = used[1];
        const l = used[2];

        const rResolution = findResolutionTarget(r, 1280, 720);
        const lResolution = findResolutionTarget(l, 640, 360);

        fps = Math.min(20, Math.max(...r.video.fpsRange));
        await configureCodecs(console, client, {
            id: r.id,
            video: {
                width: rResolution[0],
                height: rResolution[1],
                bitrateControl: 'variable',
                codec: 'h264',
                bitrate: 1 * MEGABIT,
                fps,
                keyframeInterval: fps * 4,
                quality: 5,
                profile: 'main',
            },
        });

        fps = Math.min(20, Math.max(...l.video.fpsRange));
        await configureCodecs(console, client, {
            id: l.id,
            video: {
                width: lResolution[0],
                height: lResolution[1],
                bitrateControl: 'variable',
                codec: 'h264',
                bitrate: MEGABIT / 2,
                fps,
                keyframeInterval: fps * 4,
                quality: 5,
                profile: 'main',
            },
        });
    }
    else if (used.length == 2) {
        let target: [number, number];
        if (resolution[0] * resolution[1] > 1920 * 1080)
            target = [1280, 720];
        else
            target = [640, 360];

        const rResolution = findResolutionTarget(used[1], target[0], target[1]);
        const fps = Math.min(20, Math.max(...used[1].video.fpsRange));
        await configureCodecs(console, client, {
            id: used[1].id,
            video: {
                width: rResolution[0],
                height: rResolution[1],
                bitrateControl: 'variable',
                codec: 'h264',
                bitrate: getBitrateForResolution(rResolution[0] * rResolution[1]),
                fps,
                keyframeInterval: fps * 4,
                quality: 5,
                profile: 'main',
            },
        });
    }
    else if (used.length === 1) {
        // no nop
    }

    console.log('autoconfigured codecs!');
}

export async function configureCodecs(console: Console, client: OnvifCameraAPI, options: MediaStreamOptions): Promise<MediaStreamConfiguration> {
    client.profiles = undefined;
    const profiles: any[] = await client.getProfiles();
    const profile = profiles.find(profile => profile.$.token === options.id);
    const vc = profile.videoEncoderConfiguration;
    const ac = profile.audioEncoderConfiguration;

    const { video: videoOptions, audio: audioOptions } = options;

    if (videoOptions?.codec) {
        let key: string;
        switch (videoOptions.codec) {
            case 'h264':
                key = 'H264';
                break;
            case 'h265':
                key = 'H265';
                break;
        }
        if (key) {
            vc.encoding = key;

            if (videoOptions?.keyframeInterval) {
                vc[key] ||= {};
                vc[key].govLength = videoOptions?.keyframeInterval;
            }
            if (videoOptions?.profile) {
                let profile: string;
                switch (videoOptions.profile) {
                    case 'baseline':
                        profile = 'Baseline';
                        break;
                    case 'main':
                        profile = 'Main';
                        break;
                    case 'high':
                        profile = 'High';
                        break;
                }
                if (profile) {
                    vc[key] ||= {};
                    vc[key].profile = profile;
                }
            }
        }
    }

    if (videoOptions?.width && videoOptions?.height) {
        vc.resolution ||= {};
        vc.resolution.width = videoOptions?.width;
        vc.resolution.height = videoOptions?.height;
    }

    if (videoOptions?.bitrate) {
        vc.rateControl ||= {};
        vc.rateControl.bitrateLimit = Math.floor(videoOptions?.bitrate / 1000);
    }

    // can't be set by onvif. But see if it is settable and doesn't match to direct user.
    if (videoOptions?.bitrateControl && vc.rateControl?.$?.ConstantBitRate !== undefined) {
        const constant = videoOptions?.bitrateControl === 'constant';
        if (vc.rateControl.$.ConstantBitRate !== constant)
            throw new Error(options.id + ': The camera video Bitrate Type must be set to ' + videoOptions?.bitrateControl + ' in the camera web admin.');
    }

    if (videoOptions?.fps) {
        vc.rateControl ||= {};
        vc.rateControl.frameRateLimit = videoOptions?.fps;
        vc.rateControl.encodingInterval = 1;
    }

    await client.setVideoEncoderConfiguration(vc);
    const configuredVideo = await client.getVideoEncoderConfigurationOptions(profile.$.token, vc.$.token);
    client.profiles = undefined;
    const codecs = await getCodecs(console, client);
    const foundCodec = codecs.find(codec => codec.id === options.id);
    const ret: MediaStreamConfiguration = {
        ...foundCodec,
    };
    ret.video = {
        ...ret.video,
        ...configuredVideo,
    };
    if (videoOptions?.bitrateControl) {
        ret.video.bitrateControls = ['constant', 'variable'];
    }
    return ret;
}

export async function getCodecs(console: Console, client: OnvifCameraAPI) {
    const profiles: any[] = await client.getProfiles();
    const ret: UrlMediaStreamOptions[] = [];
    for (const { $, name, videoEncoderConfiguration, audioEncoderConfiguration } of profiles) {
        try {
            ret.push({
                id: $.token,
                metadata: {
                    videoId: videoEncoderConfiguration?.$?.token,
                    audioId: audioEncoderConfiguration?.$?.token,
                },
                name: name,
                container: 'rtsp',
                url: await client.getStreamUrl($.token),
                video: {
                    fps: videoEncoderConfiguration?.rateControl?.frameRateLimit,
                    bitrate: computeBitrate(videoEncoderConfiguration?.rateControl?.bitrateLimit),
                    width: videoEncoderConfiguration?.resolution?.width,
                    height: videoEncoderConfiguration?.resolution?.height,
                    codec: fromOnvifVideoCodec(videoEncoderConfiguration?.encoding),
                    keyframeInterval: videoEncoderConfiguration?.$?.GovLength,
                    bitrateControl: videoEncoderConfiguration?.rateControl?.$?.ConstantBitRate != null
                        ? (videoEncoderConfiguration?.rateControl?.$.ConstantBitRate ? 'constant' : 'variable')
                        : undefined,
                },
                audio: {
                    bitrate: computeBitrate(audioEncoderConfiguration?.bitrate),
                    codec: fromOnvifAudioCodec(audioEncoderConfiguration?.encoding),
                }
            })
        }
        catch (e) {
            console.error('error retrieving onvif profile', $.token, e);
        }
    }

    return ret;
}
