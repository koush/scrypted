import { DeviceProvider, EngineIOHandler, HttpRequest, HttpRequestHandler, OnOff, Refresh, ScryptedDeviceBase, ScryptedDeviceType, ScryptedInterface, StartStop } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';
import { Server } from "ws";
import { EventEmitter } from 'events';
const { log, deviceManager } = sdk;

class Valve extends ScryptedDeviceBase implements StartStop, Refresh {
    system: SprinklerSystem;
    wsEvents = new EventEmitter();
    ws: WebSocket;

    constructor(system: SprinklerSystem, nativeId: string) {
        super(nativeId);
        this.system = system;

        this.wsEvents.on('state', e => {
            this.running = e.state !== 'close';
        });
    }
    attachWebSocket(ws: WebSocket) {
        this.ws = ws;
        ws.onmessage = async (message) => {
            this.log.i(message.data);
            const e = JSON.parse(message.data);
            this.wsEvents.emit(e.type, e);
        };
    }
    async getRefreshFrequency(): Promise<number> {
        return 1800;
    }
    async refresh(refreshInterface: string, userInitiated: boolean) {
        if (!this.ws)
            return;
        this.ws.send(JSON.stringify({
            type: 'state',
        }));
    }
    async stop() {
        log.i('turnOff');

        this.ws.send(JSON.stringify({
            type: 'close',
        }));
    }
    async start() {
        // set a breakpoint here.
        log.i('turnOn');

        this.ws.send(JSON.stringify({
            type: 'open',
        }));
    }
}


class SprinklerSystem extends ScryptedDeviceBase implements EngineIOHandler, DeviceProvider {
    wss = new Server({ port: 8080 });
    devices = new Map<string, Valve>();

    constructor() {
        super();
        this.running = this.running || false;
        
        sdk.endpointManager.getInsecurePublicLocalEndpoint()
        .then(endpoint => log.i(endpoint));
    }

    async discoverDevices(duration: number) {
    }
    getDevice(nativeId: string) {
        return this.devices.get(nativeId);
    }

    async onConnection(request: HttpRequest, webSocketUrl: string) {
        log.i("connection");
        const ws = new WebSocket(webSocketUrl);
        ws.onmessage = async (message) => {
            const e = JSON.parse(message.data);
            if (e.type === 'id') {
                log.i(`client connected ${message.data}`);
                const {id} = e;
                let d = this.devices.get(id);
                if (!d) {
                    d = new Valve(this, id);
                    this.devices.set(id, d);
                }
                else {
                    d.ws.close();
                }
                d.attachWebSocket(ws);

                await deviceManager.onDeviceDiscovered({
                    nativeId: id,
                    type: ScryptedDeviceType.Irrigation,
                    interfaces: [ScryptedInterface.StartStop, ScryptedInterface.Refresh],
                });
                d.log.i(`client connected ${message.data}`);
            }
        }
    }
}

export default new SprinklerSystem();
