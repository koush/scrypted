import { EngineIOHandler, HttpRequest, HttpRequestHandler, HttpResponse, MixinDeviceBase, MixinProvider, Refresh, RTCAVMessage, ScryptedDevice, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, ScryptedInterfaceProperty, ScryptedMimeTypes } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import type { SmartHomeV1DisconnectRequest, SmartHomeV1DisconnectResponse, SmartHomeV1ExecuteRequest, SmartHomeV1ExecuteResponse, SmartHomeV1ExecuteResponseCommands, SmartHomeV1QueryRequest, SmartHomeV1QueryResponse, SmartHomeV1ReportStateRequest, SmartHomeV1SyncRequest, SmartHomeV1SyncResponse } from 'actions-on-google/dist/service/smarthome/api/v1';
import { smarthome } from 'actions-on-google/dist/service/smarthome';
import type { Headers } from 'actions-on-google/dist/framework';
import { supportedTypes } from './common';
import axios from 'axios';
import throttle from 'lodash/throttle';
import http from 'http';
import './types';
import './commands';

import { commandHandlers } from './handlers';
import { canAccess } from './commands/camerastream';

import mdns from 'mdns';
import {URL} from 'url';

const { systemManager, mediaManager, endpointManager, deviceManager } = sdk;


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

const includeToken = 3;

class GoogleHome extends ScryptedDeviceBase implements HttpRequestHandler, EngineIOHandler, MixinProvider {
    linkTracker = localStorage.getItem('linkTracker');
    agentUserId = localStorage.getItem('agentUserId');
    app = smarthome({
        jwt: parseJwt(localStorage.getItem('jwt')),
    });
    reportQueue = new Set<string>();
    reportStateThrottled = throttle(() => this.reportState(), 2000);
    throttleSync = throttle(() => this.requestSync(), 15000, {
        leading: false,
        trailing: true,
    });
    plugins: Promise<any>;
    defaultIncluded: any;
    localEndpoint: http.Server;

    constructor() {
        super();

        // the tracker tracks whether this device has been reported in a sync request payload.
        // this is because reporting too many devices in the initial sync fails upstream at google.
        if (!this.linkTracker) {
            this.linkTracker = Math.random().toString();
            localStorage.setItem('linkTracker', this.linkTracker);
        }

        if (!this.agentUserId) {
            this.agentUserId = uuidv4();
            localStorage.setItem('agentUserId', this.agentUserId);
        }

        try {
            this.defaultIncluded = JSON.parse(localStorage.getItem('defaultIncluded'));
        }
        catch (e) {
            this.defaultIncluded = {};
        }

        this.app.onSync(this.onSync.bind(this));
        this.app.onQuery(this.onQuery.bind(this));
        this.app.onExecute(this.onExecute.bind(this));
        this.app.onDisconnect(this.onDisconnect.bind(this));

        systemManager.listen((source, details, data) => {
            if (source)
                this.queueReportState(source);
        });

        systemManager.listen((eventSource, eventDetails, eventData) => {
            if (eventDetails.eventInterface !== ScryptedInterface.ScryptedDevice)
                return;

            if (!eventDetails.changed)
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
            const ad = mdns.createAdvertisement(mdns.tcp('scrypted-gh'), parseInt(url.port));
            ad.start();
        });
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

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        const ws = new WebSocket(webSocketUrl);

        ws.onmessage = async (message) => {
            const token = message.data as string;

            const device = canAccess(token);
            if (!device) {
                ws.close();
                return;
            }

            const videoStream = await device.getVideoStream();
            const offer: RTCAVMessage = JSON.parse((await mediaManager.convertMediaObjectToBuffer(
                videoStream,
                ScryptedMimeTypes.RTCAVOffer
            )).toString());

            ws.send(JSON.stringify(offer));

            const answer = await new Promise(resolve => ws.onmessage = (message) => resolve(message.data)) as RTCAVMessage;
            const mo = mediaManager.createMediaObject(Buffer.from(answer), ScryptedMimeTypes.RTCAVAnswer);
            const result = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.RTCAVOffer);
            ws.send(result.toString());

            ws.onmessage = async (message) => {
                const mo = mediaManager.createMediaObject(Buffer.from(message.data), ScryptedMimeTypes.RTCAVAnswer);
                const result = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.RTCAVOffer);
                ws.send(result.toString());
            }

            const emptyObject = JSON.stringify({
                description: null,
                id: offer.id,
                candidates: [],
                configuration: null,
            });
            while (true ){
                const mo = mediaManager.createMediaObject(Buffer.from(emptyObject), ScryptedMimeTypes.RTCAVAnswer);
                const result = await mediaManager.convertMediaObjectToBuffer(mo, ScryptedMimeTypes.RTCAVOffer);
                ws.send(result.toString());
            }
        }
    }

    async queueReportState(device: ScryptedDevice) {
        if (this.storage.getItem(`link-${device.id}`) !== this.linkTracker)
            return;

        if (!await this.isSyncable(device))
            return;

        this.reportQueue.add(device.id);
        this.reportStateThrottled();
    }

    async onSync(body: SmartHomeV1SyncRequest, headers: Headers): Promise<SmartHomeV1SyncResponse> {
        const ret: SmartHomeV1SyncResponse = {
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

            probe.roomHint = device.room;
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

    async onQuery(body: SmartHomeV1QueryRequest, headers: Headers): Promise<SmartHomeV1QueryResponse> {
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

    async onExecute(body: SmartHomeV1ExecuteRequest, headers: Headers): Promise<SmartHomeV1ExecuteResponse> {
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

    async onDisconnect(body: SmartHomeV1DisconnectRequest, headers: Headers): Promise<SmartHomeV1DisconnectResponse> {
        localStorage.setItem('disconnected', '');
        return {
        }
    }

    async reportState() {
        const reporting = new Set(this.reportQueue);
        this.reportQueue.clear();

        const report: SmartHomeV1ReportStateRequest = {
            requestId: uuidv4(),
            agentUserId: this.agentUserId,
            payload: {
                devices: {
                    states: {
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
                report.payload.devices.states[id] = Object.assign({
                    online: true,
                }, status);
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
        if (this.app.jwt) {
            const result = await this.app.reportState(report);
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
        if (this.app.jwt) {
            this.app.requestSync(this.agentUserId);
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
        const body = JSON.parse(request.body);
        try {
            const result = await this.app.handler(body, request.headers as Headers);
            const res = JSON.stringify(result.body);
            this.console.log(res);
            response.send(res, {
                headers: result.headers,
                code: result.status,
            });
        }
        catch (e) {
            this.console.error(`request error ${e}`);
            response.send(e.message, {
                code: 500,
            });
        }
    }
}

export default new GoogleHome();
