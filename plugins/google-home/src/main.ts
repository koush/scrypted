import type { homegraph_v1 } from "@googleapis/homegraph/v1";
import sdk, { EngineIOHandler, EventDetails, HttpRequest, HttpRequestHandler, HttpResponse, MixinProvider, Refresh, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, Setting, SettingValue, Settings } from '@scrypted/sdk';
import type { SmartHomeV1DisconnectRequest, SmartHomeV1DisconnectResponse, SmartHomeV1ExecuteRequest, SmartHomeV1ExecuteResponse, SmartHomeV1ExecuteResponseCommands } from 'actions-on-google/dist/service/smarthome/api/v1';
import axios from 'axios';
import { GoogleAuth } from "google-auth-library";
import http from 'http';
import throttle from 'lodash/throttle';
import './commands';
import { supportedTypes } from './common';
import './types';
import { StorageSettings } from '@scrypted/sdk/storage-settings';

import { canAccess, signalCamera } from './commands/camerastream';
import { commandHandlers } from './handlers';

import { homegraph } from '@googleapis/homegraph';
import { createBrowserSignalingSession } from "@scrypted/common/src/rtc-connect";
import type { JSONClient } from 'google-auth-library/build/src/auth/googleauth';
import { URL } from 'url';

import ciao, { Protocol } from '@homebridge/ciao';

const responder = ciao.getResponder();

const { systemManager, endpointManager } = sdk;

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function parseJwt(jwt: string) {
    try {
        return JSON.parse(jwt);
    }
    catch (e) {
    }
}

const googleAuth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/homegraph'],
});

const includeToken = 3;

class GoogleHome extends ScryptedDeviceBase implements HttpRequestHandler, EngineIOHandler, MixinProvider, Settings {
    storageSettings = new StorageSettings(this, {
        // the tracker tracks whether this device has been reported in a sync request payload.
        // this is because reporting too many devices in the initial sync fails upstream at google.
        linkTracker: {
            hide: true,
            persistedDefaultValue: Math.random().toString(),
        },
        agentUserId: {
            hide: true,
            persistedDefaultValue: uuidv4(),
        },
        localAuthorization: {
            hide: true,
            persistedDefaultValue: uuidv4(),
        },
        pairedUserId: {
            title: "Pairing Key",
            description: "The pairing key used to validate requests from Google Home. Clear this key or delete the plugin to allow pairing with a different Google Home login.",
        },
    });
    get linkTracker() {
        return this.storageSettings.values.linkTracker;
    }
    get agentUserId() {
        return this.storageSettings.values.agentUserId;
    }
    get localAuthorization() {
        return this.storageSettings.values.localAuthorization;
    }
    // ids and their interfaces changed
    reportQueue = new Map<string, Set<string>>();
    reportStateThrottled = throttle(() => this.reportState(), 2000);
    throttleSync = throttle(() => this.requestSync(), 15000, {
        leading: false,
        trailing: true,
    });
    plugins: Promise<any>;
    defaultIncluded: any;
    localEndpoint: http.Server;
    jwt = parseJwt(this.storage.getItem('jwt'));
    googleAuthClient: JSONClient;

    homegraph = homegraph('v1');
    notificationsState: any = {};
    validAuths = new Set<string>();

    constructor() {
        super();

        endpointManager.setAccessControlAllowOrigin({
            origins: [
                // webrtc signaling
                'https://www.gstatic.com',
                // chromecast receiver
                'https://koush.github.io',
            ],
        });

        if (this.jwt) {
            this.googleAuthClient = googleAuth.fromJSON(this.jwt);
        }

        try {
            this.defaultIncluded = JSON.parse(localStorage.getItem('defaultIncluded'));
        }
        catch (e) {
            this.defaultIncluded = {};
        }

        systemManager.listen((source, details) => {
            if (source && details.property)
                this.queueReportState(source, details);
        });

        systemManager.listen((eventSource, eventDetails) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice)
                return;

            if (!eventDetails.property)
                return;

            if (eventDetails.property !== ScryptedInterfaceProperty.id) {
                if (this.storage.getItem(`link-${eventSource?.id}`) !== this.linkTracker) {
                    return;
                }
            }

            const device = systemManager.getDeviceById(eventSource?.id);
            this.log.i(`Device descriptor changed: ${device?.name}. Requesting sync.`);
            this.throttleSync();
        });

        this.plugins = systemManager.getComponent('plugins');

        this.localEndpoint = new http.Server((req, res) => {
            this.console.log('got request');
            res.writeHead(404);
            res.end();
        });
        this.localEndpoint.listen(12080);

        endpointManager.getInsecurePublicLocalEndpoint().then(endpoint => {
            const url = new URL(endpoint);
            this.console.log(endpoint);

            const service = responder.createService({
                name: 'Scrypted Google Home',
                type: 'scrypted-gh',
                protocol: Protocol.TCP,
                port: parseInt(url.port),
                txt: {
                    port: url.port,
                }
            });
            service.on('name-change', d => {
                this.console.log('name-change', d)
            });
            service.on('hostname-change', d => {
                this.console.log('hostname-change', d)
            });
            service.advertise();
        });
    }

    getSettings(): Promise<Setting[]> {
        return this.storageSettings.getSettings();
    }

    putSetting(key: string, value: SettingValue): Promise<void> {
        return this.storageSettings.putSetting(key, value);
    }

    async isSyncable(device: ScryptedDevice): Promise<boolean> {
        const plugins = await this.plugins;
        const mixins = (device.mixins || []).slice();
        if (mixins.includes(this.id))
            return true;

        if (this.defaultIncluded[device.id] === includeToken)
            return false;

        mixins.push(this.id);
        await plugins.setMixins(device.id, mixins);
        this.defaultIncluded[device.id] = includeToken;
        localStorage.setItem('defaultIncluded', JSON.stringify(this.defaultIncluded));
        return true;
    }

    async canMixin(type: ScryptedDeviceType, interfaces: string[]) {
        const supportedType = supportedTypes[type];
        if (!supportedType?.probe({
            type,
            interfaces,
        })) {
            return;
        }
        return [];
    }

    async getMixin(device: ScryptedDevice, mixinDeviceInterfaces: ScryptedInterface[], mixinDeviceState: { [key: string]: any }) {
        if (this.storage.getItem(`link-${mixinDeviceState.id}`) !== this.linkTracker) {
            this.log.i(`New device added to Google Home: ${mixinDeviceState.name}. Requesting sync.`);
            this.throttleSync();
        }

        return device;
    }

    async releaseMixin(id: string, mixinDevice: any) {
        const device = systemManager.getDeviceById(id);
        if (device.mixins?.includes(this.id)) {
            return;
        }
        this.log.i(`Device removed from Google Home: ${device.name}. Requesting sync.`);
        this.storage.removeItem(`link-${id}`)
        this.throttleSync();
    }

    async onConnection(request: HttpRequest, ws: WebSocket) {
        ws.onmessage = async (message) => {
            const json = JSON.parse(message.data as string);
            const { token } = json;

            const camera = canAccess(token);
            if (!camera) {
                ws.close();
                return;
            }

            try {
                const session = await createBrowserSignalingSession(ws, '@scrypted/google-home', 'cast-receiver');
                await camera.startRTCSignalingSession(session);
            }
            catch (e) {
                console.error("error negotiating browser RTCC signaling", e);
                ws.close();
                throw e;
            }
        }
    }

    async queueReportState(device: ScryptedDevice, details: EventDetails) {
        if (this.storage.getItem(`link-${device.id}`) !== this.linkTracker)
            return;

        if (!await this.isSyncable(device))
            return;

        let set = this.reportQueue.get(device.id);
        if (!set) {
            set = new Set();
            this.reportQueue.set(device.id, set);
        }
        set.add(details.eventInterface)
        this.reportStateThrottled();
    }

    async onSync(body: homegraph_v1.Schema$SyncRequest): Promise<homegraph_v1.Schema$SyncResponse> {
        const ret: homegraph_v1.Schema$SyncResponse = {
            requestId: body.requestId,
            payload: {
                agentUserId: this.agentUserId,
                devices: []
            }
        };

        let newDevices = 0;
        for (const id of Object.keys(systemManager.getSystemState())) {
            const device = systemManager.getDeviceById(id);
            const { type } = device;
            const supportedType = supportedTypes[type];

            if (!supportedType?.probe(device))
                continue;

            if (!await this.isSyncable(device))
                continue;

            const probe = await supportedType.getSyncResponse(device);

            probe.customData = {
                'localAuthorization': this.localAuthorization,
            };
            probe.roomHint = device.room;
            probe.notificationSupportedByAgent = true;
            ret.payload.devices.push(probe);

            if (this.storage.getItem(`link-${device.id}`) !== this.linkTracker) {
                this.storage.setItem(`link-${device.id}`, this.linkTracker);
                newDevices++;
            }

            if (newDevices >= 10) {
                setTimeout(() => this.requestSync(), 10000);
                break;
            }
        }

        return ret;
    }

    async onQuery(body: homegraph_v1.Schema$QueryRequest): Promise<homegraph_v1.Schema$QueryRequest> {
        const ret = {
            requestId: body.requestId,
            payload: {
                devices: {

                }
            }
        }

        for (const input of body.inputs) {
            for (const queryDevice of input.payload.devices) {
                const device = systemManager.getDeviceById(queryDevice.id);
                if (!device) {
                    this.console.error(`query for missing device ${queryDevice.id}`);
                    ret.payload.devices[queryDevice.id] = {
                        online: false,
                    };
                    continue;
                }

                const { type } = device;
                const supportedType = supportedTypes[type];
                if (!supportedType) {
                    this.console.error(`query for unsupported type ${type}`);
                    ret.payload.devices[queryDevice.id] = {
                        online: false,
                    };
                    continue;
                }

                try {
                    if (device.interfaces.includes(ScryptedInterface.Refresh))
                        (device as any as Refresh).refresh(null, true);
                    const status = await supportedType.query(device);
                    ret.payload.devices[queryDevice.id] = Object.assign({
                        status: 'SUCCESS',
                        online: true,
                    }, status);
                }
                catch (e) {
                    this.console.error(`query failure for ${device.name}`);
                    ret.payload.devices[queryDevice.id] = {
                        status: 'ERROR',
                        online: false,
                    };
                }
            }
        }

        return ret;
    }

    async onExecute(body: SmartHomeV1ExecuteRequest): Promise<SmartHomeV1ExecuteResponse> {
        const ret: SmartHomeV1ExecuteResponse = {
            requestId: body.requestId,
            payload: {
                commands: [
                ]
            }
        }
        for (const input of body.inputs) {
            for (const command of input.payload.commands) {
                for (const commandDevice of command.devices) {
                    const device = systemManager.getDeviceById(commandDevice.id);
                    if (!device) {
                        this.log.e(`execute failed, device not found ${JSON.stringify(commandDevice)}`);
                        const error: SmartHomeV1ExecuteResponseCommands = {
                            ids: [commandDevice.id],
                            status: 'ERROR',
                            errorCode: 'deviceNotFound',
                        }
                        ret.payload.commands.push(error);
                        continue;
                    }

                    this.log.i(`executing command on ${device.name}`);

                    for (const execution of command.execution) {
                        const commandHandler = commandHandlers[execution.command]
                        if (!commandHandler) {
                            this.log.e(`execute failed, command not supported ${JSON.stringify(execution)}`);
                            const error: SmartHomeV1ExecuteResponseCommands = {
                                ids: [commandDevice.id],
                                status: 'ERROR',
                                errorCode: 'functionNotSupported',
                            }
                            ret.payload.commands.push(error);
                            continue;
                        }

                        try {
                            const result = await commandHandler(device, execution);
                            ret.payload.commands.push(result);
                        }
                        catch (e) {
                            this.log.e(`execution failed ${e}`);
                            const error: SmartHomeV1ExecuteResponseCommands = {
                                ids: [commandDevice.id],
                                status: 'ERROR',
                                errorCode: 'hardError',
                            }
                            ret.payload.commands.push(error);
                        }
                    }
                }
            }
        }

        return ret;
    }

    async onDisconnect(body: SmartHomeV1DisconnectRequest): Promise<SmartHomeV1DisconnectResponse> {
        localStorage.setItem('disconnected', '');
        return {
        }
    }

    async reportState() {
        const reporting = new Set(this.reportQueue.keys());
        const map = new Map(this.reportQueue);
        this.reportQueue.clear();

        const report: homegraph_v1.Schema$ReportStateAndNotificationRequest = {
            requestId: uuidv4(),
            agentUserId: this.agentUserId,
            payload: {
                devices: {
                    states: {
                    },
                    notifications: {
                    }
                }
            }
        };

        for (const id of reporting) {
            const device = systemManager.getDeviceById(id);
            if (!device)
                continue;
            const { type } = device;
            const supportedType = supportedTypes[type];
            if (!supportedType)
                continue;
            try {
                const status = await supportedType.query(device);
                let notificationsState = this.notificationsState[device.id];
                if (!notificationsState) {
                    notificationsState = {};
                    this.notificationsState[device.id] = notificationsState;
                }

                const notifications = await supportedType.notifications?.(device, map.get(id));
                const hasNotifications = notifications && !!Object.keys(notifications).length;
                // don't report state on devices with no state
                if (!Object.keys(status).length && !hasNotifications)
                    continue;
                report.payload.devices.states[id] = Object.assign({
                    online: true,
                }, status);
                if (hasNotifications) {
                    report.payload.devices.notifications[id] = notifications;
                    // doesn't matter that this gets written per device.
                    report.eventId = Date.now().toString();
                }
            }
            catch (e) {
                report.payload.devices.states[id] = {
                    online: false,
                }
            }
        }

        if (!Object.keys(report.payload.devices.states).length)
            return;

        this.console.log('reporting state:');
        this.console.log(JSON.stringify(report, undefined, 2));
        if (this.jwt) {
            // const result = await this.app.reportState(report);
            const result = await this.homegraph.devices.reportStateAndNotification({
                auth: this.googleAuthClient,
                requestBody: report,
            });
            this.console.log('report state result:')
            this.console.log(result);
            return;
        }

        const plugins = await systemManager.getComponent('plugins');
        const id = await plugins.getIdForPluginId('@scrypted/cloud');
        const cloudStorage = await plugins.getStorage(id);
        if (!cloudStorage?.token_info) {
            this.log.w('Unable to report state to Google, no JWT token was provided and Scrypted Cloud is not installed/configured.');
            return;
        }
        const { token_info } = cloudStorage;
        const response = await axios.post('https://home.scrypted.app/_punch/reportState', report, {
            headers: {
                Authorization: `Bearer ${token_info}`
            },
        });
        this.console.log('report state result:');
        this.console.log(JSON.stringify(response.data));
    }

    async requestSync() {
        if (this.jwt) {
            this.homegraph.devices.requestSync({
                auth: this.googleAuthClient,
                requestBody: {
                    agentUserId: this.agentUserId,
                }
            });
            return;
        }

        const plugins = await systemManager.getComponent('plugins');
        const id = await plugins.getIdForPluginId('@scrypted/cloud');
        const cloudStorage = await plugins.getStorage(id);
        if (!cloudStorage?.token_info) {
            this.log.w('Unable to request Google sync, no JWT token was provided and Scrypted Cloud is not installed/configured.');
            return;
        }
        const { token_info } = cloudStorage;
        const response = await axios(`https://home.scrypted.app/_punch/requestSync?agentUserId=${this.agentUserId}`, {
            headers: {
                Authorization: `Bearer ${token_info}`
            }
        });
        this.console.log('request sync result:');
        this.console.log(JSON.stringify(response.data));
    }

    async onRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
        if (request.url.endsWith('/identify')) {
            response.send('identify', {
                code: 200,
            });
            return;
        }
        this.console.log(request.body);

        if (request.url.startsWith('/endpoint/@scrypted/google-home/public/signaling/')) {
            if (request.method === 'OPTIONS') {
                response.send('', {
                    headers: {
                        'Access-Control-Allow-Origin': request.headers.origin,
                        'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
                        'Access-Control-Allow-Headers': request.headers['access-control-request-headers'],
                    },
                    code: 200,
                });
                return;
            }

            const token = request.headers['authorization'].split('Bearer ')[1];
            const camera = canAccess(token);
            if (!camera) {
                this.console.error(`request failed due to invalid authorization`);
                response.send('Invalid Token', {
                    code: 500,
                });
            }

            const answer = await signalCamera(camera, JSON.parse(request.body));
            response.send(JSON.stringify(answer), {
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            return;
        }

        const { authorization } = request.headers;
        if (authorization !== this.localAuthorization) {
            if (!this.validAuths.has(authorization)) {
                try {
                    const getcookieResponse = await axios.get('https://home.scrypted.app/_punch/getcookie', {
                        headers: {
                            'Authorization': authorization,
                        }
                    });
                    // new tokens will contain a lot of information, including the expiry and client id.
                    // validate this. old tokens will be grandfathered in.
                    if (getcookieResponse.data.expiry && getcookieResponse.data.clientId !== 'google')
                        throw new Error('client id mismatch');
                    if (!this.storageSettings.values.pairedUserId) {
                        this.storageSettings.values.pairedUserId = getcookieResponse.data.id;
                    }
                    else if (this.storageSettings.values.pairedUserId !== getcookieResponse.data.id) {
                        this.log.a('This plugin is already paired with a different account. Clear the existing key in the plugin settings to pair this plugin with a different account.');
                        throw new Error('user id mismatch');
                    }
                    this.validAuths.add(authorization);
                }
                catch (e) {
                    this.console.error(`request failed due to invalid authorization`, e);
                    response.send(e.message, {
                        code: 500,
                    });
                    return;
                }
            }
        }

        const body = JSON.parse(request.body);
        try {
            let result: any;
            switch (body.inputs[0].intent) {
                case 'action.devices.QUERY':
                    result = await this.onQuery(body);
                    break;
                case 'action.devices.SYNC':
                    result = await this.onSync(body);
                    break;
                case 'action.devices.EXECUTE':
                    result = await this.onExecute(body);
                    break;
                case 'action.devices.DISCONNECT':
                    result = await this.onDisconnect(body);
                    break;
            }
            const res = JSON.stringify(result);
            this.console.log(res);
            response.send(res, {
                headers: result.headers,
                code: result.status,
            });
        }
        catch (e) {
            this.console.error(`request error`, e);
            response.send(e.message, {
                code: 500,
            });
        }
    }
}

export default new GoogleHome();
