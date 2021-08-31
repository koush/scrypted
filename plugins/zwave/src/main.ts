// https://developer.scrypted.app/#getting-started
import sdk, { DeviceProvider, ScryptedDeviceBase, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { CommandClassInfo, getCommandClass, getCommandClassIndex } from "./CommandClasses";
import { ZwaveDeviceBase } from "./CommandClasses/ZwaveDeviceBase";
import { getHash, getNodeHash, getInstanceHash } from "./Types";
import debounce from "lodash/debounce";
import { Driver, Endpoint, ZWaveController, ZWaveNode, CommandClass } from "zwave-js";
import { ValueID, CommandClasses } from "@zwave-js/core"
import { randomBytes } from "crypto";

const { log, deviceManager } = sdk;

export enum NodeLiveness {
    Live,
    Query,
    Dead,

    // internal state
    QueryLive,
    QueryDead,
}

class NodeLivenessInfo {
    liveness: NodeLiveness;
    time: number = Date.now();
    checker: Function;

    updateLiveness(liveness: NodeLiveness): boolean {
        this.time = Date.now();
        if (this.liveness == liveness)
            return false;
        this.liveness = liveness;
        return true;
    }
}

export class ZwaveControllerProvider extends ScryptedDeviceBase implements DeviceProvider, Settings {
    devices: Object = {};
    nodeLiveness: Object = {};
    driver: Driver;
    controller: ZWaveController;
    driverReady: Promise<void>;

    constructor() {
        super();

        this.startDriver();
    }

    startDriver() {
        let networkKey: Buffer | undefined;
        let b64Key = this.storage.getItem('networkKey');
        if (b64Key) {
            networkKey = Buffer.from(b64Key, 'base64');
        }
        else {
            networkKey = randomBytes(16);
            b64Key = networkKey.toString('base64');
            this.storage.setItem('networKey', b64Key);
            this.log.a('No Network Key was present, so a random one was generated. You can change the Network Key in Settings.')
        }
        
        const driver = new Driver(this.storage.getItem('serialPort'), {
            networkKey
        });
        this.driver = driver;
        console.log(driver.cacheDir);

        this.driverReady = new Promise((resolve, reject) => {
            driver.on("error", (e) => {
                console.error('driver error', e);
                reject(e);
            });
    
            driver.once("driver ready", () => {
                this.controller = driver.controller;
                const rebuildNode = async (node: ZWaveNode) => {
                    for (const endpoint of node.getAllEndpoints()) {
                        await this.rebuildInstance(endpoint);
                    }
                }
    
                const bindNode = (node: ZWaveNode) => {
                    node.on('value added', node => rebuildNode(node));
                    node.on('value removed', node => rebuildNode(node));
                    node.on('value updated', (node, valueId) => {
                        const dirtyKey = getInstanceHash(this.controller.homeId, node.id, valueId.endpoint);
                        const device: ZwaveDeviceBase = this.devices[dirtyKey];
                        // device may not be in use by the system. watch for that.
                        if (device && deviceManager.getNativeIds().includes(device.nativeId)) {
                            this.updateNodeLiveness(device, NodeLiveness.Live);
                            device.onValueChanged(valueId);
                        }
                    });
                    node.on('interview completed', node => rebuildNode(node));
                }
    
                this.controller.on('node added', node => {
                    this.console.log('node added', node.nodeId);
                    bindNode(node);
                    rebuildNode(node);
                })
                this.controller.on('node removed', node => {
                    this.console.log('node removed', node?.nodeId);
                })
    
                driver.controller.nodes.forEach(node => {
                    this.console.log('node loaded', node.nodeId);
                    bindNode(node);
                    rebuildNode(node);
                });

                resolve();
            });

            driver.start().catch(reject);
        });

        this.driverReady.catch(e => {
            log.a(`Zwave Driver startup error. Verify the Z-Wave USB stick is plugged in and the Serial Port setting is correct.`);
            this.console.error('zwave driver start error', e);
        });
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'Network Key',
                key: 'networkKey',
                value: this.storage.getItem('networkKey'),
                description: 'The 16 byte Base64 encoded Network Security Key',
            },
            {
                title: 'Serial Port',
                key: 'serialPort',
                value: this.storage.getItem('serialPort'),
                description: 'Serial Port path or COM Port name',
            }
        ]
    }
    async putSetting(key: string, value: string | number | boolean) {
        this.storage.setItem(key, value as string);

        await this.driver?.destroy();
        this.driver = undefined;
        this.startDriver();
    }

    async discoverDevices(duration: number) {
    }

    async getDevice(nativeId: string) {
        await this.driverReady;
        return this.devices[nativeId];
    }

    _addType(scryptedDevice: ZwaveDeviceBase, instance: Endpoint, type: CommandClassInfo, valueId: ValueID) {
        var interfaces = type.getInterfaces(instance.getNodeUnsafe(), valueId);
        if (!interfaces) {
            return;
        }

        var methods = Reflect.ownKeys(type.handlerClass.prototype).filter(v => v != 'constructor');

        for (var m of methods) {
            scryptedDevice[m] = type.handlerClass.prototype[m];
        }

        scryptedDevice.device.interfaces.push(...interfaces);
        scryptedDevice.commandClasses.push(type);
    }

    async rebuildInstance(instance: Endpoint) {
        const nativeId = getHash(this.controller, instance);
        let scryptedDevice: ZwaveDeviceBase = this.devices[nativeId];
        if (!scryptedDevice) {
            scryptedDevice = new ZwaveDeviceBase(this.controller, instance);
            scryptedDevice.zwaveController = this;
            const node = instance.getNodeUnsafe();
            let name: string;
            if (node.supportsCC(CommandClasses['Node Naming and Location'])) {
                const nodeNaming = instance.getNodeUnsafe().commandClasses["Node Naming and Location"];
                name = await nodeNaming?.getName();
            }
            scryptedDevice.device = {
                name,
                interfaces: [],
                nativeId,
            };
        }

        for (let cc of instance.getSupportedCCInstances()) {
            var type = getCommandClass(cc.ccId);
            if (type) {
                await this._addType(scryptedDevice, instance, type, null);
                continue;
            }
        }

        const values = instance.getNodeUnsafe().getDefinedValueIDs().filter(value => value.endpoint == instance.index);
        for (var value of values) {
            var type = getCommandClassIndex(value.commandClass, value.property as number);
            if (!type) {
                continue;
            }

            this._addType(scryptedDevice, instance, type, value);
        }

        if (!scryptedDevice.device.interfaces.length) {
            delete this.devices[nativeId];
            // remove?
            return;
        }
        this.devices[nativeId] = scryptedDevice;
        // Refresh is problematic. Perhaps another method on Online to do a real health check.
        scryptedDevice.device.interfaces.push('Refresh', 'Online');
        // scryptedDevice.device.interfaces.push('Online');
        await deviceManager.onDeviceDiscovered(scryptedDevice.device);
        scryptedDevice.updateState();

        // todo: watch for name change and sync to zwave controller
        const node = instance.getNodeUnsafe();
        if (node.supportsCC(CommandClasses['Node Naming and Location'])) {
            const naming = instance.getNodeUnsafe().commandClasses?.['Node Naming and Location'];
            naming?.setName(scryptedDevice.name);
        }

        if (scryptedDevice.device.interfaces.includes(ScryptedInterface.Battery)) {
            scryptedDevice.instance.getNodeUnsafe().refreshCCValues(CommandClasses['Battery']);
        }
    }

    updateNodeLiveness(device: ZwaveDeviceBase, liveness: NodeLiveness) {
        var key = getNodeHash(this.controller, device.instance.getNodeUnsafe());
        var current: NodeLivenessInfo = this.nodeLiveness[key];

        if (!current) {
            current = new NodeLivenessInfo();
            current.liveness = liveness;
            this.nodeLiveness[key] = current;
            device.online = this.isNodeOnline(device.instance.getNodeUnsafe());
            return;
        }

        if (liveness == NodeLiveness.Live || liveness == NodeLiveness.Dead) {
            if (current.updateLiveness(liveness)) {
                device.online = this.isNodeOnline(device.instance.getNodeUnsafe());
            }
            return;
        }

        // if the existing liveness is too old, this node's liveness status gets downgraded
        if (current.time < Date.now() - 60000) {
            if (current.liveness == null)
                current.liveness = NodeLiveness.Live;
            switch (current.liveness) {
                case NodeLiveness.Live:
                case NodeLiveness.Query:
                    liveness = NodeLiveness.QueryLive;
                    break;
                case NodeLiveness.QueryLive:
                    liveness = NodeLiveness.QueryDead;
                    break;
                case NodeLiveness.QueryDead:
                    liveness = NodeLiveness.Dead;
                    break;
                default:
                    liveness = NodeLiveness.Dead;
            }
            device.log.w("Node has been downgraded: " + liveness);
            if (current.updateLiveness(liveness))
                device.online = this.isNodeOnline(device.instance.getNodeUnsafe());
        }
        else if (current.liveness == NodeLiveness.Live) {
            device.log.i("Node was recently online. Stopping healthcheck until a later query.");
            return;
        }

        // dead is dead. wait for it to come back. no more health checking.
        if (liveness == NodeLiveness.Dead) {
            device.log.e("Node is not online. Stopping health checks until it returns.");
            return;
        }

        // check the health again in a bit.
        if (!current.checker) {
            current.checker = debounce(() => {
                this.updateNodeLiveness(device, NodeLiveness.Query);
            }, 30000);
        }
        current.checker();
    }

    isNodeOnline(node: ZWaveNode): boolean {
        var info: NodeLivenessInfo = this.nodeLiveness[getNodeHash(this.controller, node)];
        if (info == null || info.liveness == null || info.liveness == NodeLiveness.Live || info.liveness == NodeLiveness.QueryLive || info.liveness == NodeLiveness.Query)
            return true;

        return false;
    }
}

export default new ZwaveControllerProvider();
