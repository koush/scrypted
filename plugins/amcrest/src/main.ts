import { automaticallyConfigureSettings, checkPluginNeedsAutoConfigure } from "@scrypted/common/src/autoconfigure-codecs";
import { ffmpegLogInitialOutput } from '@scrypted/common/src/media-helpers';
import { readLength } from "@scrypted/common/src/read-stream";
import sdk, { Camera, DeviceCreatorSettings, DeviceInformation, FFmpegInput, Intercom, Lock, MediaObject, MediaStreamOptions, ObjectDetectionTypes, ObjectDetector, ObjectsDetected, Reboot, RequestPictureOptions, RequestRecordingStreamOptions, ResponseMediaStreamOptions, ScryptedDeviceType, ScryptedInterface, ScryptedMimeTypes, ScryptedNativeId, Setting, VideoCameraConfiguration, VideoRecorder, VideoTextOverlay, VideoTextOverlays } from "@scrypted/sdk";
import child_process, { ChildProcess } from 'child_process';
import { PassThrough, Readable, Stream } from "stream";
import { OnvifIntercom } from "../../onvif/src/onvif-intercom";
import { createRtspMediaStreamOptions, RtspProvider, RtspSmartCamera, UrlMediaStreamOptions } from "../../rtsp/src/rtsp";
import { AmcrestCameraClient, AmcrestEvent, AmcrestEventData } from "./amcrest-api";
import { amcrestAutoConfigureSettings, autoconfigureSettings } from "./amcrest-configure";

const { mediaManager } = sdk;

const AMCREST_DOORBELL_TYPE = 'Amcrest Doorbell';
const DAHUA_DOORBELL_TYPE = 'Dahua Doorbell';

const rtspChannelSetting: Setting = {
    subgroup: 'Advanced',
    key: 'rtspChannel',
    title: 'Channel Number Override',
    description: "The channel number to use for snapshots and video. E.g., 1, 2, etc.",
    placeholder: '1',
};

class AmcrestCamera extends RtspSmartCamera implements VideoCameraConfiguration, Camera, Intercom, Lock, VideoRecorder, Reboot, ObjectDetector, VideoTextOverlays {
    eventStream: Stream;
    cp: ChildProcess;
    client: AmcrestCameraClient;
    videoStreamOptions: Promise<UrlMediaStreamOptions[]>;
    onvifIntercom = new OnvifIntercom(this);
    hasSmartDetection: boolean;

    constructor(nativeId: string, provider: RtspProvider) {
        super(nativeId, provider);
        if (this.storage.getItem('amcrestDoorbell') === 'true') {
            this.storage.setItem('doorbellType', AMCREST_DOORBELL_TYPE);
            this.storage.removeItem('amcrestDoorbell');
        }

        this.hasSmartDetection = this.storage.getItem('hasSmartDetection') === 'true';
        this.updateDevice();
        this.updateDeviceInfo();
    }

    async getVideoTextOverlays(): Promise<Record<string, VideoTextOverlay>> {
        const client = this.getClient();
        const response = await client.request({
            method: "GET",
            url: `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=getConfig&name=VideoWidget`,
            responseType: "text",
            headers: {
                "Content-Type": "application/xml",
            },
        });
        const body: string = response.body;
        if (!body.startsWith("<")) {
            const encodeBlend = '.EncodeBlend';
            const config: Record<string, VideoTextOverlay> = {};

            for (const line of body.split(/\r?\n/).filter(l => l.includes(encodeBlend + '='))) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const splitIndex = trimmed.indexOf("=");
                if (splitIndex === -1) continue;
                // remove encodeBlend
                let key = trimmed.substring(0, splitIndex);
                key = key.substring(0, key.length - encodeBlend.length);
                config[key] = {
                    readonly: true,
                };
            }

            const textValue = '.Text';

            for (const line of body.split(/\r?\n/).filter(l => l.includes(textValue + '='))) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                const splitIndex = trimmed.indexOf("=");
                if (splitIndex === -1) continue;
                // remove encodeBlend
                let key = trimmed.substring(0, splitIndex);
                key = key.substring(0, key.length - textValue.length);
                const text = trimmed.substring(splitIndex + 1).trim();
                const c = config[key];
                if (!c)
                    continue;
                delete c.readonly;
                c.text = text;
            }

            return config;
        } else {
            throw new Error('invalid response');
            // const json = await xml2js.parseStringPromise(body);
            // return { json, xml: body };
        }
    }

    async setVideoTextOverlay(id: string, value: VideoTextOverlay): Promise<void> {
        // trim the table. off id
        if (id.startsWith('table.'))
            id = id.substring('table.'.length);
        const client = this.getClient();
        if (value.text) {
            const enableUrl = `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&${id}.EncodeBlend=true&${id}.PreviewBlend=true`;
            await client.request({
                method: "GET",
                url: enableUrl,
                responseType: "text",
            });

            const textUrl = `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&${id}.Text=${encodeURIComponent(
                value.text
            )}`;
            await client.request({
                method: "GET",
                url: textUrl,
                responseType: "text",
            });
        }
        else {
            const disableUrl = `http://${this.getHttpAddress()}/cgi-bin/configManager.cgi?action=setConfig&${id}.EncodeBlend=false&${id}.PreviewBlend=false`;
            await client.request({
                method: "GET",
                url: disableUrl,
                responseType: "text",
            });
        }
    }

    async reboot() {
        const client = this.getClient();
        await client.reboot();
    }

    getRecordingStreamCurrentTime(recordingStream: MediaObject): Promise<number> {
        throw new Error("Method not implemented.");
    }

    getRecordingStreamThumbnail(time: number): Promise<MediaObject> {
        throw new Error("Method not implemented.");
    }

    async getRecordingStream(options: RequestRecordingStreamOptions): Promise<MediaObject> {
        // ffplay 'rtsp://user:password@192.168.2.87/cam/playback?channel=1&starttime=2022_03_12_21_00_00'
        const startTime = new Date(options.startTime);
        const month = (startTime.getMonth() + 1).toString().padStart(2, '0');
        const date = startTime.getDate().toString().padStart(2, '0');
        const year = startTime.getFullYear();
        const hours = startTime.getHours().toString().padStart(2, '0');
        const minutes = startTime.getMinutes().toString().padStart(2, '0');
        const seconds = startTime.getSeconds().toString().padStart(2, '0');;

        const url = `rtsp://${this.getRtspAddress()}/cam/playback?channel=1&starttime=${year}_${month}_${date}_${hours}_${minutes}_${seconds}`;
        const authedUrl = this.addRtspCredentials(url);
        return this.createMediaStreamUrl(authedUrl, undefined);
    }

    getRecordingStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return this.getVideoStreamOptions();
    }

    async updateDeviceInfo(): Promise<void> {
        const ip = this.storage.getItem('ip');
        if (!ip)
            return;

        const managementUrl = `http://${ip}`;
        const deviceInfo: DeviceInformation = {
            ...this.info,
            ip,
            managementUrl,
        };

        const deviceParameters = [
            { action: "getVendor", replace: "vendor=", parameter: "manufacturer" },
            { action: "getSerialNo", replace: "sn=", parameter: "serialNumber" },
            { action: "getDeviceType", replace: "type=", parameter: "model" },
            { action: "getSoftwareVersion", replace: "version=", parameter: "firmware" }
        ];

        for (const element of deviceParameters) {
            try {
                const response = await this.getClient().request({
                    url: `http://${this.getHttpAddress()}/cgi-bin/magicBox.cgi?action=${element.action}`,
                    responseType: 'text',
                });
                const result = String(response.body).replace(element.replace, "").trim();
                deviceInfo[element.parameter] = result;
            }
            catch (e) {
                this.console.error('Error getting device parameter', element.action, e);
            }
        }

        this.info = deviceInfo;
    }

    async setVideoStreamOptions(options: MediaStreamOptions) {
        const channel = parseInt(this.getRtspChannel()) || 1;
        const client = this.getClient();
        return client.configureCodecs(channel, options);
    }

    getClient() {
        if (!this.client)
            this.client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
        return this.client;
    }

    async listenEvents() {
        let motionTimeout: NodeJS.Timeout;

        const motionTimeoutDuration = 20000;
        const resetMotionTimeout = () => {
            clearTimeout(motionTimeout);
            motionTimeout = setTimeout(() => {
                this.motionDetected = false;
            }, motionTimeoutDuration);
        }

        const client = new AmcrestCameraClient(this.getHttpAddress(), this.getUsername(), this.getPassword(), this.console);
        const events = await client.listenEvents();
        const doorbellType = this.storage.getItem('doorbellType');
        const callerId = this.storage.getItem('callerID');
        const multipleCallIds = this.storage.getItem('multipleCallIds') === 'true';

        let pulseTimeout: NodeJS.Timeout;

        events.on('event', (event: AmcrestEvent, index: string, payload: string) => {
            const channelNumber = this.getRtspChannel();
            if (channelNumber) {
                const idx = parseInt(index) + 1;
                if (idx.toString() !== channelNumber)
                    return;
            }
            if (event === AmcrestEvent.MotionStart
                || event === AmcrestEvent.SmartMotionHuman
                || event === AmcrestEvent.SmartMotionVehicle
                || event === AmcrestEvent.CrossLineDetection
                || event === AmcrestEvent.CrossRegionDetection) {
                this.motionDetected = true;
                resetMotionTimeout();
            }
            else if (event === AmcrestEvent.MotionInfo) {
                // this seems to be a motion pulse
                if (!this.motionDetected)
                    this.motionDetected = true;
                resetMotionTimeout();
            }
            else if (event === AmcrestEvent.MotionStop) {
                // use resetMotionTimeout
            }
            else if (event === AmcrestEvent.AudioStart) {
                this.audioDetected = true;
            }
            else if (event === AmcrestEvent.AudioStop) {
                this.audioDetected = false;
            }
            else if (event === AmcrestEvent.TalkInvite
                || event === AmcrestEvent.PhoneCallDetectStart
                || event === AmcrestEvent.AlarmIPCStart
                || event === AmcrestEvent.DahuaTalkInvite) {
                if (event === AmcrestEvent.DahuaTalkInvite && payload && multipleCallIds) {
                    if (payload.includes(callerId)) {
                        this.binaryState = true;
                    }
                } else {
                    this.binaryState = true;
                }
            }
            else if (event === AmcrestEvent.TalkHangup
                || event === AmcrestEvent.PhoneCallDetectStop
                || event === AmcrestEvent.AlarmIPCStop
                || event === AmcrestEvent.DahuaCallDeny
                || event === AmcrestEvent.DahuaTalkHangup) {
                this.binaryState = false;
            }
            else if (event === AmcrestEvent.TalkPulse && doorbellType === AMCREST_DOORBELL_TYPE) {
                if (payload.includes('Invite')) {
                    this.binaryState = true;
                }
                else if (payload.includes('Hangup')) {
                    this.binaryState = false;
                }
            }
            else if (event === AmcrestEvent.DahuaTalkPulse && doorbellType === DAHUA_DOORBELL_TYPE) {
                clearTimeout(pulseTimeout);
                pulseTimeout = setTimeout(() => this.binaryState = false, 3000);
                this.binaryState = true;
            }
        });

        events.on('smart', (className: string, data: AmcrestEventData) => {
            if (!this.hasSmartDetection) {
                this.hasSmartDetection = true;
                this.storage.setItem('hasSmartDetection', 'true');
                this.updateDevice();
            }

            const detected: ObjectsDetected = {
                timestamp: Date.now(),
                detections: [
                    {
                        score: 1,
                        className,
                    }
                ],
            };

            this.onDeviceEvent(ScryptedInterface.ObjectDetector, detected);
        });

        return events;
    }

    async getDetectionInput(detectionId: string, eventId?: any): Promise<MediaObject> {
        return;
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        return {
            classes: [
                'person',
                'face',
                'car',
            ],
        }
    }

    async getOtherSettings(): Promise<Setting[]> {
        const ret = await super.getOtherSettings();
        ret.push(
            {
                subgroup: 'Advanced',
                title: 'Doorbell Type',
                choices: [
                    'Not a Doorbell',
                    AMCREST_DOORBELL_TYPE,
                    DAHUA_DOORBELL_TYPE,
                ],
                description: 'If this device is a doorbell, select the appropriate doorbell type.',
                value: this.storage.getItem('doorbellType') || 'Not a Doorbell',
                key: 'doorbellType',
            },
        );

        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === AMCREST_DOORBELL_TYPE || doorbellType === DAHUA_DOORBELL_TYPE;

        let twoWayAudio = this.storage.getItem('twoWayAudio');

        const choices = [
            'Amcrest',
            'ONVIF',
        ];

        if (!isDoorbell)
            choices.unshift('None');

        twoWayAudio = choices.find(c => c === twoWayAudio);

        if (!twoWayAudio)
            twoWayAudio = isDoorbell ? 'Amcrest' : 'None';


        if (doorbellType == DAHUA_DOORBELL_TYPE) {
            ret.push(
                {
                    title: 'Enable Dahua Lock',
                    key: 'enableDahuaLock',
                    description: 'Some Dahua Doorbells have a built in lock/door access control.',
                    type: 'boolean',
                    value: (this.storage.getItem('enableDahuaLock') === 'true').toString(),
                }
            );

            ret.push(
                {
                    title: 'Multiple Call Buttons',
                    key: 'multipleCallIds',
                    description: 'Some Dahua Doorbells integrate multiple Call Buttons for apartment buildings.',
                    type: 'boolean',
                    value: (this.storage.getItem('multipleCallIds') === 'true').toString(),
                }
            );
        }

        const multipleCallIds = this.storage.getItem('multipleCallIds');

        if (multipleCallIds) {
            ret.push(
                {
                    title: 'Caller ID',
                    key: 'callerID',
                    description: 'Caller ID',
                    type: 'number',
                    value: this.storage.getItem('callerID'),
                }
            )
        }


        ret.push(
            {
                subgroup: 'Advanced',
                title: 'Two Way Audio',
                value: twoWayAudio,
                key: 'twoWayAudio',
                description: 'Amcrest cameras may support both Amcrest and ONVIF two way audio protocols. ONVIF generally performs better when supported.',
                choices,
            },
            // sdcard write causes jitter.
            // {
            //     title: 'Continuous Recording',
            //     key: 'continuousRecording',
            //     description: 'Continuously record onto the Camera SD Card.',
            //     type: 'boolean',
            //     value: (this.storage.getItem('continuousRecording') === 'true').toString(),
            // },
        );

        const ac = {
            ...automaticallyConfigureSettings,
            subgroup: 'Advanced',
        };
        ac.type = 'button';
        ret.push(ac);
        ret.push({
            ...amcrestAutoConfigureSettings,
            subgroup: 'Advanced',
        });

        return ret;
    }

    async takeSmartCameraPicture(options?: RequestPictureOptions): Promise<MediaObject> {
        return this.createMediaObject(await this.getClient().jpegSnapshot(options?.timeout), 'image/jpeg');
    }

    async getUrlSettings() {
        const rtspChannel = {
            ...rtspChannelSetting,
            value: this.storage.getItem('rtspChannel'),
        };
        return [
            rtspChannel,
            ...await super.getUrlSettings(),
        ]
    }

    getRtspChannel() {
        return this.storage.getItem('rtspChannel');
    }

    createRtspMediaStreamOptions(url: string, index: number) {
        const ret = createRtspMediaStreamOptions(url, index);
        ret.tool = 'scrypted';
        return ret;
    }

    async getConstructedVideoStreamOptions(): Promise<UrlMediaStreamOptions[]> {
        const client = this.getClient();

        if (this.videoStreamOptions)
            return this.videoStreamOptions;

        this.videoStreamOptions = (async () => {
            const cameraNumber = parseInt(this.getRtspChannel()) || 1;
            try {
                let vsos: UrlMediaStreamOptions[];
                try {
                    vsos = await client.getCodecs(cameraNumber);
                    this.storage.setItem('vsosJSON', JSON.stringify(vsos));
                }
                catch (e) {
                    this.console.error('error retrieving stream configurations', e);
                    vsos = JSON.parse(this.storage.getItem('vsosJSON')) as UrlMediaStreamOptions[];
                }

                for (const [index, vso] of vsos.entries()) {
                    vso.tool = 'scrypted';
                    vso.url = `rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=${cameraNumber}&subtype=${index}`;
                }
                return vsos;
            }
            catch (e) {
                this.videoStreamOptions = undefined;
                const vsos = [...Array(2).keys()].map(subtype => {
                    const ret = createRtspMediaStreamOptions(`rtsp://${this.getRtspAddress()}/cam/realmonitor?channel=${cameraNumber}&subtype=${subtype}`, subtype);
                    ret.tool = 'scrypted';
                    return ret;
                });
                return vsos;
            }
        })();

        return this.videoStreamOptions;
    }

    updateDevice() {
        const doorbellType = this.storage.getItem('doorbellType');
        const isDoorbell = doorbellType === AMCREST_DOORBELL_TYPE || doorbellType === DAHUA_DOORBELL_TYPE;
        // true is the legacy value before onvif was added.
        const twoWayAudio = this.storage.getItem('twoWayAudio') === 'true'
            || this.storage.getItem('twoWayAudio') === 'ONVIF'
            || this.storage.getItem('twoWayAudio') === 'Amcrest';

        const interfaces = this.provider.getInterfaces();
        let type: ScryptedDeviceType = undefined;
        if (isDoorbell) {
            type = ScryptedDeviceType.Doorbell;
            interfaces.push(ScryptedInterface.BinarySensor)
        }
        if (isDoorbell || twoWayAudio) {
            interfaces.push(ScryptedInterface.Intercom);
        }

        const enableDahuaLock = this.storage.getItem('enableDahuaLock') === 'true';
        if (isDoorbell && doorbellType === DAHUA_DOORBELL_TYPE && enableDahuaLock) {
            interfaces.push(ScryptedInterface.Lock);
        }

        const continuousRecording = this.storage.getItem('continuousRecording') === 'true';
        if (continuousRecording)
            interfaces.push(ScryptedInterface.VideoRecorder);

        if (this.hasSmartDetection)
            interfaces.push(ScryptedInterface.ObjectDetector);

        this.provider.updateDevice(this.nativeId, this.name, interfaces, type);
    }

    async putSetting(key: string, value: string) {
        if (key === automaticallyConfigureSettings.key) {
            const client = this.getClient();
            autoconfigureSettings(client, parseInt(this.getRtspChannel()) || 1)
                .then(() => {
                    this.log.a('Successfully configured settings.');
                })
                .catch(e => {
                    this.log.a('There was an error automatically configuring settings. More information can be viewed in the console.');
                    this.console.error('error autoconfiguring', e);
                });
            return;
        }

        if (key === 'continuousRecording') {
            if (value === 'true') {
                try {
                    await this.getClient().enableContinousRecording(parseInt(this.getRtspChannel()) || 1);
                    this.storage.setItem('continuousRecording', 'true');
                }
                catch (e) {
                    this.log.a('There was an error enabling continuous recording.');
                    this.console.error('There was an error enabling continuous recording.', e);
                }
            }
            else {
                this.storage.removeItem('continuousRecording');
            }
        }

        this.client = undefined;
        this.videoStreamOptions = undefined;

        super.putSetting(key, value);

        this.updateDevice();
        this.updateDeviceInfo();
    }

    async startIntercom(media: MediaObject): Promise<void> {
        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            const options = await this.getConstructedVideoStreamOptions();
            const stream = options[0];
            const url = new URL(stream.url);
            // amcrest onvif requires this proto query parameter, or onvif two way
            // will not activate.
            url.searchParams.set('proto', 'Onvif');
            this.onvifIntercom.url = url.toString();
            return this.onvifIntercom.startIntercom(media);
        }

        const doorbellType = this.storage.getItem('doorbellType');

        // not sure if this all works, since i don't actually have a doorbell.
        // good luck!
        const channel = parseInt(this.getRtspChannel()) || 1;

        const buffer = await mediaManager.convertMediaObjectToBuffer(media, ScryptedMimeTypes.FFmpegInput);
        const ffmpegInput = JSON.parse(buffer.toString()) as FFmpegInput;

        const args = ffmpegInput.inputArguments.slice();
        args.unshift('-hide_banner');

        let contentType: string;

        if (doorbellType == DAHUA_DOORBELL_TYPE) {
            args.push(
                "-vn",
                '-acodec', 'pcm_alaw',
                '-ac', '1',
                '-ar', '8000',
                '-sample_fmt', 's16',
                '-f', 'alaw',
                'pipe:3',
            );
            contentType = 'Audio/G.711A';
        }
        else {
            args.push(
                "-vn",
                '-acodec', 'aac',
                '-f', 'adts',
                'pipe:3',
            );
            contentType = 'Audio/AAC';
            // args.push(
            //     "-vn",
            //     '-acodec', 'pcm_mulaw',
            //     '-ac', '1',
            //     '-ar', '8000',
            //     '-sample_fmt', 's16',
            //     '-f', 'mulaw',
            //     'pipe:3',
            // );
            // contentType = 'Audio/G.711A';
        }

        this.console.log('ffmpeg intercom', args);

        const ffmpeg = await mediaManager.getFFmpegPath();
        this.cp = child_process.spawn(ffmpeg, args, {
            stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
        });
        this.cp.on('exit', () => this.cp = undefined);
        ffmpegLogInitialOutput(this.console, this.cp);
        const socket = this.cp.stdio[3] as Readable;

        (async () => {
            const url = `http://${this.getHttpAddress()}/cgi-bin/audio.cgi?action=postAudio&httptype=singlepart&channel=${channel}`;
            this.console.log('posting audio data to', url);

            // seems the dahua doorbells preferred 1024 chunks. should investigate adts
            // parsing and sending multipart chunks instead.
            const passthrough = new PassThrough();
            const abortController = new AbortController();
            this.getClient().request({
                url,
                method: 'POST',
                headers: {
                    'Content-Type': contentType,
                    'Content-Length': '9999999',
                },
                signal: abortController.signal,
                responseType: 'readable',
            }, passthrough)
                .catch(() => { })
                .finally(() => this.console.log('request finished'))

            try {
                while (true) {
                    const data = await readLength(socket, 1024);
                    passthrough.push(data);
                }
            }
            catch (e) {
            }
            finally {
                this.console.log('audio finished');
                passthrough.destroy();
                abortController.abort();
            }

            this.stopIntercom();
        })();
    }

    async stopIntercom(): Promise<void> {
        if (this.storage.getItem('twoWayAudio') === 'ONVIF') {
            return this.onvifIntercom.stopIntercom();
        }

        this.cp?.kill();
        this.cp = undefined;
    }

    showRtspUrlOverride() {
        return false;
    }

    async lock(): Promise<void> {
        if (!this.client.lock()) {
            this.console.error("Could not lock");
        }
    }

    async unlock(): Promise<void> {
        if (!this.client.unlock()) {
            this.console.error("Could not unlock");
        }
    }
}

class AmcrestProvider extends RtspProvider {
    constructor(nativeId?: ScryptedNativeId) {
        super(nativeId);
        checkPluginNeedsAutoConfigure(this);
    }

    getAdditionalInterfaces() {
        return [
            ScryptedInterface.Reboot,
            ScryptedInterface.VideoCameraConfiguration,
            ScryptedInterface.Camera,
            ScryptedInterface.AudioSensor,
            ScryptedInterface.MotionSensor,
            ScryptedInterface.VideoTextOverlays,
        ];
    }

    getScryptedDeviceCreator(): string {
        return 'Amcrest Camera';
    }

    async createDevice(settings: DeviceCreatorSettings, nativeId?: string): Promise<string> {
        const httpAddress = `${settings.ip}:${settings.httpPort || 80}`;
        let info: DeviceInformation = {};

        const username = settings.username?.toString();
        const password = settings.password?.toString();
        const skipValidate = settings.skipValidate?.toString() === 'true';
        let twoWayAudio: string;

        const api = new AmcrestCameraClient(httpAddress, username, password, this.console);
        if (settings.autoconfigure) {
            const cameraNumber = parseInt(settings.rtspChannel as string) || 1;
            await autoconfigureSettings(api, cameraNumber);
        }

        if (!skipValidate) {
            try {
                const deviceInfo = await api.getDeviceInfo();

                settings.newCamera = deviceInfo.deviceType;
                info.model = deviceInfo.deviceType;
                info.serialNumber = deviceInfo.serialNumber;
            }
            catch (e) {
                this.console.error('Error adding Amcrest camera', e);
                throw e;
            }

            try {
                if (await api.checkTwoWayAudio()) {
                    // onvif seems to work better than Amcrest, except for AD110.
                    twoWayAudio = 'ONVIF';
                }
            }
            catch (e) {
                this.console.warn('Error probing two way audio', e);
            }
        }
        settings.newCamera ||= 'Amcrest Camera';

        nativeId = await super.createDevice(settings, nativeId);

        const device = await this.getDevice(nativeId) as AmcrestCamera;
        device.info = info;
        device.putSetting('username', username);
        device.putSetting('password', password);
        if (settings.rtspChannel)
            device.putSetting('rtspChannel', settings.rtspChannel as string);
        device.setHttpPortOverride(settings.httpPort?.toString());
        device.setIPAddress(settings.ip?.toString());
        if (twoWayAudio)
            device.putSetting('twoWayAudio', twoWayAudio);
        device.updateDeviceInfo();
        return nativeId;
    }

    async getCreateDeviceSettings(): Promise<Setting[]> {
        return [
            {
                key: 'username',
                title: 'Username',
            },
            {
                key: 'password',
                title: 'Password',
                type: 'password',
            },
            {
                key: 'ip',
                title: 'IP Address',
                placeholder: '192.168.2.222',
            },
            rtspChannelSetting,
            {
                subgroup: 'Advanced',
                key: 'httpPort',
                title: 'HTTP Port',
                description: 'Optional: Override the HTTP Port from the default value of 80.',
                placeholder: '80',
            },
            automaticallyConfigureSettings,
            amcrestAutoConfigureSettings,
            {
                subgroup: 'Advanced',
                key: 'skipValidate',
                title: 'Skip Validation',
                description: 'Add the device without verifying the credentials and network settings.',
                type: 'boolean',
            }
        ]
    }

    createCamera(nativeId: string) {
        return new AmcrestCamera(nativeId, this);
    }

}

export default AmcrestProvider;
