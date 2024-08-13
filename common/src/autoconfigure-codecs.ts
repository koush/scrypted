import sdk, { AudioStreamOptions, MediaStreamConfiguration, MediaStreamDestination, MediaStreamOptions, ScryptedDeviceBase, Setting } from "@scrypted/sdk";

export const automaticallyConfigureSettings: Setting = {
    key: 'autoconfigure',
    title: 'Automatically Configure Settings',
    description: 'Automatically configure and valdiate the camera codecs and other settings for optimal Scrypted performance. Some settings will require manual configuration via the camera web admin.',
    type: 'boolean',
    value: true,
};

export const onvifAutoConfigureSettings: Setting = {
    key: 'onvif-autoconfigure',
    type: 'html',
    value: 'ONVIF autoconfiguration will configure the camera codecs. <b>The camera motion sensor must still be <a target="_blank" href="https://docs.scrypted.app/camera-preparation.html#motion-sensor-setup">configured manually</a>.</b>',
};

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

export async function checkPluginNeedsAutoConfigure(plugin: ScryptedDeviceBase, extraDevices = 0) {
    if (plugin.storage.getItem('autoconfigure') === 'true')
        return;

    plugin.storage.setItem('autoconfigure', 'true');
    if (sdk.deviceManager.getNativeIds().length <= 1 + extraDevices)
        return;
    plugin.log.a(`${plugin.name} now has support for automatic camera configuration for optimal performance. Cameras can be autoconfigured in their respective settings.`);
}

export async function autoconfigureCodecs(
    getCodecs: () => Promise<MediaStreamOptions[]>,
    configureCodecs: (options: MediaStreamOptions) => Promise<MediaStreamConfiguration>,
    audioOptions?: AudioStreamOptions,
) {
    audioOptions ||= {
        codec: 'pcm_mulaw',
        bitrate: 64000,
        sampleRate: 8000,
    };

    const codecs = await getCodecs();
    const configurable: MediaStreamConfiguration[] = [];
    for (const codec of codecs) {
        const config = await configureCodecs({
            id: codec.id,
        });
        configurable.push(config);
    }

    const used: MediaStreamConfiguration[] = [];

    for (const _ of ['local', 'remote', 'low-resolution'] as MediaStreamDestination[]) {
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

        const targetArea = width * height;
        for (const res of config.video.resolutions) {
            const actualArea = res[0] * res[1];
            const diffArea = Math.abs(targetArea - actualArea);            
            if (diffArea < diff) {
                diff = diffArea;
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

    let errors = '';

    const logConfigureCodecs = async (config: MediaStreamConfiguration) => {
        try {
            await configureCodecs(config);
        }
        catch (e) {
            errors += e;
        }
    }

    await logConfigureCodecs({
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
        audio: audioOptions,
    });

    if (used.length === 3) {
        // find remote and low
        const r = used[1];
        const l = used[2];

        const rResolution = findResolutionTarget(r, 1280, 720);
        const lResolution = findResolutionTarget(l, 640, 360);

        fps = Math.min(20, Math.max(...r.video.fpsRange));
        await logConfigureCodecs({
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
            audio: audioOptions,
        });

        fps = Math.min(20, Math.max(...l.video.fpsRange));
        await logConfigureCodecs({
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
            audio: audioOptions,
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
        await logConfigureCodecs({
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
            audio: audioOptions,
        });
    }
    else if (used.length === 1) {
        // no nop
    }

    if (errors)
        throw new Error(errors);
}
