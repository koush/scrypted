import sdk, { ScryptedDeviceBase, DeviceManifest, DeviceProvider, HttpRequest, HttpRequestHandler, HttpResponse, HumiditySensor, MediaObject, MotionSensor, OauthClient, Refresh, ScryptedDeviceType, ScryptedInterface, Setting, Settings, TemperatureSetting, TemperatureUnit, Thermometer, ThermostatMode, VideoCamera, BinarySensor, DeviceInformation, RTCAVSignalingSetup, Camera, PictureOptions, ObjectsDetected, ObjectDetector, ObjectDetectionTypes, FFmpegInput, RequestMediaStreamOptions, Readme, RTCSignalingChannel, RTCSessionControl, RTCSignalingSession, ResponseMediaStreamOptions, RTCSignalingSendIceCandidate, ScryptedMimeTypes, MediaStreamUrl, TemperatureCommand, OnOff } from '@scrypted/sdk';
import { connectRTCSignalingClients } from '@scrypted/common/src/rtc-signaling';
import { sleep } from '@scrypted/common/src/sleep';
import axios from 'axios';
import ClientOAuth2 from 'client-oauth2';
import { randomBytes } from 'crypto';
import fs from 'fs';
import throttle from 'lodash/throttle';
import querystring from "querystring";
import { URL } from 'url';

const { deviceManager, mediaManager, endpointManager, systemManager } = sdk;

const refreshFrequency = 60;

const readmeV1 = fs.readFileSync('README-camera-v1.md').toString();
const readmeV2 = fs.readFileSync('README-camera-v2.md').toString();

function getSdmRtspMediaStreamOptions(): ResponseMediaStreamOptions {
    return {
        id: 'default',
        name: 'Cloud RTSP',
        container: 'rtsp',
        video: {
            codec: 'h264',
        },
        audio: {
            codec: 'aac',
        },
        source: 'cloud',
        tool: 'scrypted',
        userConfigurable: false,
    };
}

function deviceHasEventImages(device: any) {
    return !!device?.traits?.['sdm.devices.traits.CameraEventImage'];
}

function deviceIsWebRtc(device: any) {
    return device?.traits?.['sdm.devices.traits.CameraLiveStream']?.supportedProtocols?.includes('WEB_RTC');
}

function createNestOfferSetup(): RTCAVSignalingSetup {
    return {
        type: 'offer',
        audio: {
            direction: 'recvonly',
        },
        video: {
            direction: 'recvonly',
        },
        datachannel: {
            label: 'dataSendChannel',
            dict: {
                id: 1,
            },
        },
    }
};

function fromNestMode(mode: string): ThermostatMode {
    switch (mode) {
        case 'HEAT':
            return ThermostatMode.Heat;
        case 'COOL':
            return ThermostatMode.Cool;
        case 'HEATCOOL':
            return ThermostatMode.HeatCool;
        case 'OFF':
            return ThermostatMode.Off;
    }
}
function fromNestStatus(status: string): ThermostatMode {
    switch (status) {
        case 'HEATING':
            return ThermostatMode.Heat;
        case 'COOLING':
            return ThermostatMode.Cool;
        case 'OFF':
            return ThermostatMode.Off;
    }
}
function toNestMode(mode: ThermostatMode): string {
    switch (mode) {
        case ThermostatMode.Heat:
            return 'HEAT';
        case ThermostatMode.Cool:
            return 'COOL';
        case ThermostatMode.HeatCool:
            return 'HEATCOOL';
        case ThermostatMode.Off:
            return 'OFF';
    }
}

class NestRTCSessionControl implements RTCSessionControl {
    refreshAt = Date.now() + 4 * 60 * 1000;

    constructor(public camera: NestCamera, public options: { streamExtensionToken: string, mediaSessionId: string }) {
    }

    async setPlayback(options: { audio: boolean; video: boolean; }): Promise<void> {

    }

    async getRefreshAt(): Promise<number> {
        return this.refreshAt;
    }

    async extendSession() {
        const result = await this.camera.provider.authPost(`/devices/${this.camera.nativeId}:executeCommand`, {
            command: `sdm.devices.commands.CameraLiveStream.ExtendWebRtcStream`,
            params: {
                streamExtensionToken: this.options.streamExtensionToken,
                mediaSessionId: this.options.mediaSessionId,
            }
        });

        this.options = result.data.results;
        this.refreshAt = Date.now() + 4 * 60 * 1000;
    }

    async endSession() {
        await this.camera.provider.authPost(`/devices/${this.camera.nativeId}:executeCommand`, {
            command: "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
            params: {
                mediaSessionId: this.options.mediaSessionId,
            },
        });
    }
}

class NestCamera extends ScryptedDeviceBase implements Readme, Camera, VideoCamera, MotionSensor, BinarySensor, ObjectDetector, RTCSignalingChannel {
    lastMotionEventId: string;
    lastImage: Promise<Buffer>;
    streams = new Map<string, any>();

    constructor(public provider: GoogleSmartDeviceAccess, public device: any) {
        super(device.name.split('/').pop());
        this.provider = provider;
        this.device = device;
    }

    async startRTCSignalingSession(session: RTCSignalingSession): Promise<RTCSessionControl> {
        let mediaSessionId: string;
        let streamExtensionToken: string;
        let _answerSdp: string;

        const options = {
            requiresOffer: true,
            disableTrickle: true,
        };
        const answerSession: RTCSignalingSession = {
            __proxy_props: {
                options,
            },
            options,
            createLocalDescription: async (type: "offer" | "answer", setup: RTCAVSignalingSetup, sendIceCandidate: RTCSignalingSendIceCandidate): Promise<RTCSessionDescriptionInit> => {
                if (type !== 'answer')
                    throw new Error('Google Camera only supports RTC answer');
                if (sendIceCandidate)
                    throw new Error("Alexa does not support trickle ICE");

                return {
                    type: 'answer',
                    sdp: _answerSdp,
                };
            },

            setRemoteDescription: async (description: RTCSessionDescriptionInit, setup: RTCAVSignalingSetup) => {
                const offerSdp = description.sdp.replace('a=ice-options:trickle\r\n', '')
                    // hack, webrtc plugin is not resecting recvonly for some reason
                    .replaceAll('sendrecv', 'recvonly');

                const result = await this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, {
                    command: "sdm.devices.commands.CameraLiveStream.GenerateWebRtcStream",
                    params: {
                        offerSdp,
                    },
                });
                const { answerSdp, mediaSessionId: msid, streamExtensionToken: set } = result.data.results;
                _answerSdp = answerSdp;
                mediaSessionId = msid;
                streamExtensionToken = set;

                return {
                    sdp: answerSdp,
                    type: 'answer',
                } as any;
            },

            addIceCandidate: async (candidate: RTCIceCandidateInit) => {
                throw new Error("Google Camera does not support trickle ICE");
            },

            getOptions: async () => {
                return options;
            }
        }

        await connectRTCSignalingClients(this.console, session, createNestOfferSetup(), answerSession, {});

        return new NestRTCSessionControl(this, {
            mediaSessionId,
            streamExtensionToken,
        });
    }

    trackStream(id: string, result: any) {
        this.streams.set(id, result);
    }

    async getReadmeMarkdown(): Promise<string> {
        return this.isWebRtc ? readmeV2 : readmeV1;
    }

    // not sure if this works? there is a camera snapshot generate image thing, but it
    // does not exist on the new cameras.
    getDetectionInput(detectionId: any, eventId?: any): Promise<MediaObject> {
        throw new Error('Method not implemented.');
    }

    async getObjectTypes(): Promise<ObjectDetectionTypes> {
        return {
            classes: ['person'],
        }
    }

    async takePicture(options?: PictureOptions): Promise<MediaObject> {
        // if this stream is prebuffered, its safe to use the prebuffer to generate an image
        const realDevice = systemManager.getDeviceById<VideoCamera>(this.id);
        try {
            const msos = await realDevice.getVideoStreamOptions();
            const prebuffered: RequestMediaStreamOptions = msos.find(mso => mso.prebuffer);
            if (prebuffered) {
                prebuffered.refresh = false;
                return realDevice.getVideoStream(prebuffered);
            }
        }
        catch (e) {
        }

        // try to fetch the latest event image if one is queued
        const hasEventImages = deviceHasEventImages(this.device);
        if (hasEventImages && this.lastMotionEventId) {
            const eventId = this.lastMotionEventId;
            this.lastMotionEventId = undefined;
            const result = this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, {
                command: "sdm.devices.commands.CameraEventImage.GenerateImage",
                params: {
                    eventId,
                },
            }).then(response => response.data);
            this.lastImage = result;
        }

        // use the last event image
        if (this.lastImage) {
            const data = await this.lastImage;
            return mediaManager.createMediaObject(data, 'image/jpeg');
        }

        throw new Error('snapshot unavailable');
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    addRefreshOptions(trackerId: string, mso: ResponseMediaStreamOptions): ResponseMediaStreamOptions {
        return Object.assign(mso, {
            refreshAt: Date.now() + 4 * 60 * 1000,
            metadata: {
                trackerId,
            },
        });
    }

    createFFmpegMediaObject(trackerId: string, url: string) {
        const ret: MediaStreamUrl = {
            url,
            mediaStreamOptions: this.addRefreshOptions(trackerId, getSdmRtspMediaStreamOptions()),
        };

        return this.createMediaObject(ret, ScryptedMimeTypes.MediaStreamUrl);
    }

    get isWebRtc() {
        return deviceIsWebRtc(this.device);
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        if (options?.metadata?.trackerId) {
            const { trackerId } = options?.metadata;
            const { streamExtensionToken, mediaSessionId } = this.streams.get(trackerId);
            const result = await this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, {
                command: `sdm.devices.commands.CameraLiveStream.ExtendRtspStream`,
                params: {
                    streamExtensionToken,
                    mediaSessionId,
                }
            });

            this.trackStream(trackerId, result.data.results);

            const mso = getSdmRtspMediaStreamOptions();
            this.addRefreshOptions(trackerId, mso);

            const ffmpegInput: FFmpegInput = {
                url: undefined,
                mediaStreamOptions: mso,
                inputArguments: undefined,
            }
            return mediaManager.createFFmpegMediaObject(ffmpegInput);
        }

        const result = await this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, {
            command: "sdm.devices.commands.CameraLiveStream.GenerateRtspStream",
            params: {}
        });
        const trackerId = randomBytes(8).toString('hex');
        this.trackStream(trackerId, result.data.results);
        return this.createFFmpegMediaObject(trackerId, result.data.results.streamUrls.rtspUrl);
    }

    async getVideoStreamOptions(): Promise<ResponseMediaStreamOptions[]> {
        return [
            getSdmRtspMediaStreamOptions(),
        ];
    }
}

const setpointMap = new Map<string, string>();
setpointMap.set('sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange', 'HEATCOOL');
setpointMap.set('sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat', 'HEAT');
setpointMap.set('sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool', 'COOL');

const setpointReverseMap = new Map<ThermostatMode, string>();
setpointReverseMap.set(ThermostatMode.HeatCool, 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange');
setpointReverseMap.set(ThermostatMode.Heat, 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat');
setpointReverseMap.set(ThermostatMode.Cool, 'sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool');

class NestThermostat extends ScryptedDeviceBase implements HumiditySensor, Thermometer, TemperatureSetting, Settings, Refresh, OnOff {
    device: any;
    provider: GoogleSmartDeviceAccess;
    executeCommandSetMode: any = undefined;
    executeCommandSetCelsius: any = undefined;
    executeCommandSetTimer: any = undefined;

    executeThrottle = throttle(async () => {
        if (this.executeCommandSetCelsius) {
            const mode = setpointMap.get(this.executeCommandSetCelsius.command);
            if (mode !== this.device.traits['sdm.devices.traits.ThermostatMode'].mode
                && this.executeCommandSetMode?.params.mode !== mode) {
                this.executeCommandSetMode = {
                    command: 'sdm.devices.commands.ThermostatMode.SetMode',
                    params: {
                        mode: mode,
                    },
                };
            }
        }
        if (this.executeCommandSetMode) {
            const command = this.executeCommandSetMode;
            this.executeCommandSetMode = undefined;
            this.console.log('executeCommandSetMode', command);
            await this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, command);
        }
        if (this.executeCommandSetCelsius) {
            const command = this.executeCommandSetCelsius;
            this.executeCommandSetCelsius = undefined;
            this.console.log('executeCommandSetCelsius', command);
            return this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, command);
        }
        if (this.executeCommandSetTimer) {
            const command = this.executeCommandSetTimer;
            this.executeCommandSetTimer = undefined;
            this.console.log('executeCommandSetTimer', command);
            return this.provider.authPost(`/devices/${this.nativeId}:executeCommand`, command);
        }
    }, 12000)

    constructor(provider: GoogleSmartDeviceAccess, device: any) {
        super(device.name.split('/').pop());
        this.provider = provider;
        this.device = device;

        this.reload();
    }

    async setTemperature(command: TemperatureCommand): Promise<void> {
        // set this in case round trip is slow.
        let { mode, setpoint } = command;
        if (mode) {
            const nestMode = toNestMode(mode);
            this.device.traits['sdm.devices.traits.ThermostatMode'].mode = nestMode;

            this.executeCommandSetMode = {
                command: 'sdm.devices.commands.ThermostatMode.SetMode',
                params: {
                    mode: nestMode,
                },
            }
        }

        if (command.setpoint) {
            mode ||= fromNestMode(this.device.traits['sdm.devices.traits.ThermostatMode'].mode);

            this.executeCommandSetCelsius = {
                command: setpointReverseMap.get(mode),
                params: {
                },
            };

            if (typeof command.setpoint === 'number') {
                if (mode === ThermostatMode.Heat) {
                    this.executeCommandSetCelsius.params.heatCelsius = command.setpoint;

                }
                else if (mode === ThermostatMode.Cool) {
                    this.executeCommandSetCelsius.params.coolCelsius = command.setpoint;
                }
                else {
                    this.executeCommandSetCelsius.params.coolCelsius = command.setpoint;
                    this.executeCommandSetCelsius.params.heatCelsius = command.setpoint;
                }
            }
            else {
                this.executeCommandSetCelsius.params.heatCelsius = command.setpoint[0];
                this.executeCommandSetCelsius.params.coolCelsius = command.setpoint[1];
            }
        }
        await this.executeThrottle();
        await this.refresh(null, true);
    }

    async setTemperatureUnit(temperatureUnit: TemperatureUnit): Promise<void> {
        // not supported by API. throw?
    }

    async turnOff(): Promise<void> {
        // You can't turn the fan off when the HVAC unit is currently running.
        if (this.temperatureSetting?.activeMode !== ThermostatMode.Off) {
            this.on = false;
            await this.refresh(null, true); // Refresh the state to turn the fan switch back to active.
            return;
        }
        this.executeCommandSetTimer = {
            command: 'sdm.devices.commands.Fan.SetTimer',
            params: {
                timerMode: 'OFF',
            },
        }
        await this.executeThrottle();
        await this.refresh(null, true);
    }
    async turnOn(): Promise<void> {
        this.executeCommandSetTimer = {
            command: 'sdm.devices.commands.Fan.SetTimer',
            params: {
                timerMode: 'ON',
            },
        }
        await this.executeThrottle();
        await this.refresh(null, true);
    }

    reload() {
        const device = this.device;

        const modes: ThermostatMode[] = [];
        for (const mode of device.traits['sdm.devices.traits.ThermostatMode'].availableModes) {
            const nest = fromNestMode(mode);
            if (nest)
                modes.push(nest);
            else
                this.console.warn('unknown mode', mode);

        }
        const thermostatMode = fromNestMode(device.traits['sdm.devices.traits.ThermostatMode'].mode);
        const thermostatActiveMode = fromNestStatus(device.traits['sdm.devices.traits.ThermostatHvac'].status);
        // round the temperature to 1 digit to prevent state noise.
        this.temperature = Math.round(10 * device.traits['sdm.devices.traits.Temperature'].ambientTemperatureCelsius) / 10;
        this.humidity = Math.round(10 * device.traits["sdm.devices.traits.Humidity"].ambientHumidityPercent) / 10;
        this.temperatureUnit = device.traits['sdm.devices.traits.Settings']?.temperatureScale === 'FAHRENHEIT' ? TemperatureUnit.F : TemperatureUnit.C;
        const heat = device.traits?.['sdm.devices.traits.ThermostatTemperatureSetpoint']?.heatCelsius;
        const cool = device.traits?.['sdm.devices.traits.ThermostatTemperatureSetpoint']?.coolCelsius;

        let setpoint: number | [number, number];
        if (thermostatMode === ThermostatMode.Heat) {
            setpoint = heat;
        }
        else if (thermostatMode === ThermostatMode.Cool) {
            setpoint = cool;
        }
        else if (thermostatMode === ThermostatMode.HeatCool) {
            setpoint = [heat, cool];
        }

        this.temperatureSetting = {
            activeMode: thermostatActiveMode,
            mode: thermostatMode,
            setpoint,
            availableModes: modes,
        }

        // Set Fan Status
        this.on = thermostatActiveMode !== ThermostatMode.Off || device.traits?.['sdm.devices.traits.Fan']?.timerMode === "ON";
    }

    async refresh(refreshInterface: string, userInitiated: boolean): Promise<void> {
        const data = await this.provider.refresh();
        const device = data.devices.find(device => device.name.split('/').pop() === this.nativeId);
        if (!device)
            throw new Error('device missing from device list on refresh');
        this.device = device;
        this.reload();
    }

    async getRefreshFrequency(): Promise<number> {
        return refreshFrequency;
    }

    async getSettings(): Promise<Setting[]> {
        const ret: Setting[] = [];
        for (const key of Object.keys(this.device.traits['sdm.devices.traits.Settings'])) {
            ret.push({
                title: key,
                value: this.device.traits['sdm.devices.traits.Settings'][key],
                readonly: true,
            });
        }
        return ret;
    }
    async putSetting(key: string, value: string | number | boolean): Promise<void> {
    }
}

export class GoogleSmartDeviceAccess extends ScryptedDeviceBase implements OauthClient, DeviceProvider, Settings, HttpRequestHandler {
    token: ClientOAuth2.Token;
    nestDevices = new Map<string, any>();
    devices = new Map<string, NestCamera | NestThermostat>();

    clientId: string;
    clientSecret: string;
    projectId: string;

    authorizationUri: string;
    client: ClientOAuth2;

    apiHostname: string;

    startup: Promise<void>;

    updateClient() {
        this.clientId = this.storage.getItem('clientId') || '827888101440-6jsq0saim1fh1abo6bmd9qlhslemok2t.apps.googleusercontent.com';
        this.clientSecret = this.storage.getItem('clientSecret') || 'nXgrebmaHNvZrKV7UDJV3hmg';
        this.projectId = this.storage.getItem('projectId');// || '778da527-9690-4368-9c96-6872bb29e7a0';
        if (!this.projectId) {
            this.log.a('Enter a valid project ID. See README for more information.');
        }

        const authorizationHostname = this.storage.getItem('authorizationHostname') || 'nestservices.google.com';
        this.authorizationUri = `https://${authorizationHostname}/partnerconnections/${this.projectId}/auth`
        this.client = new ClientOAuth2({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            accessTokenUri: 'https://www.googleapis.com/oauth2/v4/token',
            authorizationUri: this.authorizationUri,
            scopes: [
                'https://www.googleapis.com/auth/sdm.service',
            ]
        });

        this.apiHostname = this.storage.getItem('apiHostname') || 'smartdevicemanagement.googleapis.com';
    }

    refreshThrottled = throttle(async () => {
        const response = await this.authGet('/devices');
        const userId = response.headers['user-id'];
        this.console.log('user-id', userId);
        return response.data;
    }, refreshFrequency * 1000);

    constructor() {
        super();
        this.updateClient();

        this.startup = (async () => {
            while (true) {
                try {
                    await this.discoverDevices(0);
                    return;
                }
                catch (e) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        })();
    }
    async releaseDevice(id: string, nativeId: string): Promise<void> {
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        const payload = JSON.parse(Buffer.from(JSON.parse(request.body).message.data, 'base64').toString());
        this.console.log(payload);

        const traits = payload.resourceUpdate?.traits;
        const events = payload.resourceUpdate?.events;

        const nativeId = payload.resourceUpdate?.name.split('/').pop();
        const device = this.nestDevices.get(nativeId);
        if (device) {
            if (traits) {
                Object.assign(device.traits, traits);
                if (device.type === 'sdm.devices.types.THERMOSTAT') {
                    const thermostat: NestThermostat = this.devices.get(nativeId) as any;
                    if (thermostat) {
                        thermostat.device = device;
                        thermostat?.reload();
                    }
                }
            }

            if (events) {
                if (events['sdm.devices.events.CameraMotion.Motion']
                    || events['sdm.devices.events.CameraPerson.Person']) {
                    const camera: NestCamera = this.devices.get(nativeId) as any;
                    if (camera) {
                        camera.motionDetected = true;
                        const eventId = events['sdm.devices.events.CameraMotion.Motion']?.eventId
                            || events['sdm.devices.events.CameraPerson.Person']?.eventId;
                        camera.lastMotionEventId = eventId;
                        // images expire in 30 seconds after publish
                        setTimeout(() => {
                            if (camera.lastMotionEventId === eventId)
                                camera.lastMotionEventId = undefined;
                        }, 30);
                        setTimeout(() => camera.motionDetected = false, 30000);
                        if (events['sdm.devices.events.CameraPerson.Person']) {
                            this.onDeviceEvent(ScryptedInterface.ObjectDetection, {
                                timestamp: Date.now(),
                                detections: [
                                    {
                                        className: 'person',
                                    },
                                ],
                            } as ObjectsDetected);
                        }
                    }
                }

                if (events['sdm.devices.events.DoorbellChime.Chime']) {
                    const camera: NestCamera = this.devices.get(nativeId) as any;
                    if (camera) {
                        camera.binaryState = true;
                        setTimeout(() => camera.binaryState = false, 30000);
                    }
                }
            }
        }

        response.send('ok');
    }

    async getSettings(): Promise<Setting[]> {
        let endpoint = 'Error retrieving Cloud Endpoint';
        try {
            endpoint = await endpointManager.getPublicCloudEndpoint();
        }
        catch (e) {
        }

        return [
            {
                key: 'projectId',
                title: 'Project ID',
                description: 'Google Device Access Project ID',
                value: this.storage.getItem('projectId'),
            },
            {
                key: 'clientId',
                title: 'Google OAuth Client ID',
                description: 'The Google OAuth Client ID from Google Cloud Project.',
                value: this.storage.getItem('clientId'),
            },
            {
                key: 'clientSecret',
                title: 'Google OAuth Client Secret',
                description: 'The Google OAuth Client Secret from Google Cloud Project.',
                value: this.storage.getItem('clientSecret'),
            },
            {
                title: "PubSub Address",
                description: "The PubSub address to enter in Google Cloud Project.",
                key: 'pubsubAddress',
                readonly: true,
                value: endpoint,
                placeholder: 'http://somehost.dyndns.org',
            },
        ];
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        this.storage.setItem(key, value as string);
        this.updateClient();
        this.token = undefined;
        this.refresh();
    }

    async loadToken() {
        try {
            if (!this.token) {
                this.token = this.client.createToken(JSON.parse(this.storage.getItem('token')));
                this.token.expiresIn(-1000);
            }
        }
        catch (e) {
            this.console.error('token error', e);
            this.log.a('Missing token. Please log in.');
            throw new Error('Missing token. Please log in.');
        }
        if (this.token.expired()) {
            this.token = await this.token.refresh();
            this.saveToken();
        }
    }

    saveToken() {
        this.storage.setItem('token', JSON.stringify(this.token.data));
    }

    async refresh(): Promise<any> {
        return this.refreshThrottled();
    }

    async getOauthUrl(): Promise<string> {
        const params = {
            client_id: this.clientId,
            access_type: 'offline',
            prompt: 'consent',
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/sdm.service',
        }
        return `${this.authorizationUri}?${querystring.stringify(params)}`;
    }
    async onOauthCallback(callbackUrl: string) {
        const cb = new URL(callbackUrl);
        cb.search = '';
        const redirectUri = cb.toString();
        this.token = await this.client.code.getToken(callbackUrl, {
            redirectUri,
        });
        this.saveToken();

        this.discoverDevices(0).catch(() => { });
    }

    async authGet(path: string) {
        this.console.log('SDM request', path);
        await this.loadToken();
        return axios(`https://${this.apiHostname}/v1/enterprises/${this.projectId}${path}`, {
            headers: {
                Authorization: `Bearer ${this.token.accessToken}`
            }
        });
    }

    async authPost(path: string, data: any) {
        this.console.log('SDM request', path);
        await this.loadToken();
        return axios.post(`https://${this.apiHostname}/v1/enterprises/${this.projectId}${path}`, data, {
            headers: {
                Authorization: `Bearer ${this.token.accessToken}`
            }
        });
    }

    async discoverDevices(duration: number): Promise<void> {
        let data: any;
        while (true) {
            try {
                // this call is throttled too, the sleep below is so the code doenst look weird
                data = await this.refresh();
                break;
            }
            catch (e) {
                this.console.error(e);
                await sleep(1000);
            }
        }

        const deviceManifest: DeviceManifest = {
            devices: [],
        };
        this.nestDevices.clear();
        for (const device of data.devices) {
            const nativeId = device.name.split('/').pop();
            const info: DeviceInformation = {
                manufacturer: 'Nest',
            };
            if (device.type === 'sdm.devices.types.THERMOSTAT') {
                this.nestDevices.set(nativeId, device);

                deviceManifest.devices.push({
                    name: device.traits?.['sdm.devices.traits.Info']?.customName || device.parentRelations?.[0]?.displayName,
                    nativeId: nativeId,
                    type: ScryptedDeviceType.Thermostat,
                    interfaces: [
                        ScryptedInterface.TemperatureSetting,
                        ScryptedInterface.HumiditySensor,
                        ScryptedInterface.Thermometer,
                        ScryptedInterface.Settings,
                        ScryptedInterface.OnOff
                    ],
                    info,
                })
            }
            else if (device.type === 'sdm.devices.types.CAMERA'
                || device.type === 'sdm.devices.types.DOORBELL'
                || device.type === 'sdm.devices.types.DISPLAY') {
                this.nestDevices.set(nativeId, device);

                const interfaces = [
                    ScryptedInterface.MotionSensor,
                    ScryptedInterface.ObjectDetector,
                    ScryptedInterface.Readme,
                ];

                if (deviceHasEventImages(device))
                    interfaces.push(ScryptedInterface.Camera);

                if (deviceIsWebRtc(device))
                    interfaces.push(ScryptedInterface.RTCSignalingChannel);
                else
                    interfaces.push(ScryptedInterface.VideoCamera);

                let type = ScryptedDeviceType.Camera;
                if (device.type === 'sdm.devices.types.DOORBELL') {
                    interfaces.push(ScryptedInterface.BinarySensor);
                    type = ScryptedDeviceType.Doorbell;
                }

                deviceManifest.devices.push({
                    name: device.traits?.['sdm.devices.traits.Info']?.customName || device.parentRelations?.[0]?.displayName,
                    nativeId: nativeId,
                    type,
                    interfaces,
                    info,
                })
            }
            else {
                this.console.log('unhandled device type', device.type);
            }
        }

        await deviceManager.onDevicesChanged(deviceManifest);
        for (const device of deviceManifest.devices) {
            this.getDevice(device.nativeId);
        }
    }

    async getDevice(nativeId: string) {
        await this.startup;
        let found = this.devices.get(nativeId);
        if (found)
            return found;
        const device = this.nestDevices.get(nativeId);
        if (!device)
            return;
        if (device.type === 'sdm.devices.types.THERMOSTAT')
            found = new NestThermostat(this, device);
        else if (device.type === 'sdm.devices.types.CAMERA'
            || device.type === 'sdm.devices.types.DOORBELL'
            || device.type === 'sdm.devices.types.DISPLAY')
            found = new NestCamera(this, device);

        this.devices.set(nativeId, found);
        return found;
    }
}

export default new GoogleSmartDeviceAccess();
