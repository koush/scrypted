// https://developer.scrypted.app/#getting-started
import sdk, { DeviceProvider, ScryptedDeviceBase, ScryptedInterface, Setting, Settings } from "@scrypted/sdk";
import { CommandClassInfo, getCommandClass, getCommandClassIndex } from "./CommandClasses";
import { ZwaveDeviceBase } from "./CommandClasses/ZwaveDeviceBase";
import { getHash, getNodeHash, getInstanceHash } from "./Types";
import debounce from "lodash/debounce";
import { Driver, Endpoint, ZWaveController, ZWaveNode, InclusionUserCallbacks, InclusionGrant, InclusionStrategy, NodeStatus, InclusionState } from "zwave-js";
import { ValueID, CommandClasses } from "@zwave-js/core"
import { randomBytes } from "crypto";
import path from "path";
import { isHex } from "./hex";

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
    dskDeferred: { reject: any, resolve: any };

    constructor() {
        super();

        this.startDriver();
    }

    startDriver() {
        this.driverReady = new Promise((resolve, reject) => {
            let networkKey = this.storage.getItem('networkKey');
            let s2AccessControlKey = this.storage.getItem('s2AccessControlKey');
            let s2AuthenticatedKey = this.storage.getItem('s2AuthenticatedKey');
            let s2UnauthenticatedKey = this.storage.getItem('s2UnauthenticatedKey');

            // 1/17/2022: the network key was stored as base64, but for consistency with HA
            // and others, it was switched to hex. this is the data migration.
            if (!isHex(networkKey) && networkKey) {
                networkKey = Buffer.from(networkKey, 'base64').toString('hex');
                this.storage.setItem('networkKey', networkKey);
            }

            if (!networkKey) {
                networkKey = randomBytes(16).toString('hex').toUpperCase();
                this.storage.setItem('networkKey', networkKey);
                this.log.a('No Network Key was present, so a random one was generated. You can change the Network Key in Settings.')
            }

            if (!s2AccessControlKey) {
                s2AccessControlKey = randomBytes(16).toString('hex').toUpperCase();
                this.storage.setItem('s2AccessControlKey', s2AccessControlKey);
                this.log.a('No S2 Access Control Key was present, so a random one was generated. You can change the S2 Access Control Key in Settings.');
            }

            if (!s2AuthenticatedKey) {
                s2AuthenticatedKey = randomBytes(16).toString('hex').toUpperCase();
                this.storage.setItem('s2AuthenticatedKey', s2AuthenticatedKey);
                this.log.a('No S2 Authenticated Key was present, so a random one was generated. You can change the S2 Access Control Key in Settings.');
            }

            if (!s2UnauthenticatedKey) {
                s2UnauthenticatedKey = randomBytes(16).toString('hex').toUpperCase();
                this.storage.setItem('s2UnauthenticatedKey', s2UnauthenticatedKey);
                this.log.a('No S2 Unauthenticated Key was present, so a random one was generated. You can change the S2 Unauthenticated Key in Settings.')
            }

            const cacheDir = path.join(process.env['SCRYPTED_PLUGIN_VOLUME'], 'cache');
            this.console.log(process.cwd());

            const driver = new Driver(this.storage.getItem('serialPort'), {
                features: {
                    softReset: this.storage.getItem('softReset') === 'true',
                    unresponsiveControllerRecovery: false,
                    watchdog: false,
                },
                securityKeys: {
                    S2_Unauthenticated: Buffer.from(s2UnauthenticatedKey, 'hex'),
                    S2_Authenticated: Buffer.from(s2AuthenticatedKey, 'hex'),
                    S2_AccessControl: Buffer.from(s2AccessControlKey, 'hex'),
                    S0_Legacy: Buffer.from(networkKey, 'hex')
                },
                storage: {
                    cacheDir,
                }
            });
            this.driver = driver;
            console.log(driver.cacheDir);

            driver.on("error", (e) => {
                driver.destroy().catch(() => { });
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
                    node.on('value removed', node => {
                        // node is being removed
                        if (!this.controller.nodes.get(node.id))
                            return;
                        rebuildNode(node);
                    });
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
                });

                this.controller.on('node removed', node => {
                    this.console.log('node removed', node?.nodeId);
                });

                driver.controller.nodes.forEach(node => {
                    this.console.log('node loaded', node.nodeId);
                    bindNode(node);
                    rebuildNode(node);
                });

                resolve();
                log.clearAlerts();
            });

            driver.start().catch(reject);
        });

        this.driverReady.catch(e => {
            log.a(`Zwave Driver startup error. Verify the Z-Wave USB stick is plugged in and the Serial Port setting is correct.`);
            this.console.error('zwave driver start error', e);
            this.console.log('This issue may be due to a driver or database lock. Retrying in 60 seconds.');
            setTimeout(() => this.startDriver(), 60000);
        });
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                group: 'Inclusion',
                title: 'Inclusion State',
                key: 'inclusionState',
                readonly: true,
                value: InclusionState[this.controller?.inclusionState],
            },
            {
                group: 'Inclusion',
                title: 'Exclude Device',
                key: 'exclusion',
                type: 'button',
                description: 'Enter exclusion mode and remove devices.',
            },
            {
                group: 'Inclusion',
                title: 'Include Device',
                key: 'inclusion',
                type: 'button',
                description: 'Enter inclusion mode and add devices.',
            },
            {
                group: 'Inclusion',
                key: 'confirmPin',
                title: 'Confirm PIN',
                description: 'Some devices will require confirmation of a PIN while including them. Enter the PIN here when prompted.',
            },
            {
                group: 'Network',
                title: 'Healing State',
                key: 'healingState',
                readonly: true,
                value: this.controller?.isRebuildingRoutes ? 'Healing' : 'Not Healing',
            },
            {
                group: 'Network',
                title: 'Heal Network',
                key: 'heal',
                type: 'button',
                description: 'Heal the Z-Wave Network. This operation may take a long time and the network may become unreponsive while in progress.',
            },
            {
                group: 'Adapter',
                title: 'Soft Reset',
                key: 'softReset',
                type: 'boolean',
                value: this.storage.getItem('softReset') === 'true',
                description: 'Soft Reset the adapter on startup.',
            },
            {
                group: 'Adapter',
                title: 'Serial Port',
                key: 'serialPort',
                value: this.storage.getItem('serialPort'),
                description: 'Serial Port path or COM Port name',
                placeholder: '/dev/tty.usbmodem14501',
            },
            {
                group: 'Adapter',
                title: 'Network Key',
                key: 'networkKey',
                value: this.storage.getItem('networkKey'),
                description: 'The 16 byte hex encoded Network Security Key',
            },
            {
                group: 'Adapter',
                title: 'S2 Access Control Key',
                key: 's2AccessControlKey',
                value: this.storage.getItem('s2AccessControlKey'),
                description: 'The 16 byte hex encoded S2 Access Control Key',
            },
            {
                group: 'Adapter',
                title: 'S2 Authenticated Key',
                key: 's2AuthenticatedKey',
                value: this.storage.getItem('s2AuthenticatedKey'),
                description: 'The 16 byte hex encoded S2 Authenticated Key',
            },
            {
                group: 'Adapter',
                title: 'S2 Unauthenticated Key',
                key: 's2UnauthenticatedKey',
                value: this.storage.getItem('s2UnauthenticatedKey'),
                description: 'The 16 byte hex encoded S2 Unauthenticated Key',
            },
        ]
    }

    async stopOperations() {
        // this.controller.stopHealingNetwork();
        await this.controller.stopExclusion();
        await this.controller.stopInclusion();
    }

    async inclusion() {
        const userCallbacks: InclusionUserCallbacks = {
            grantSecurityClasses: async (requested: InclusionGrant): Promise<false | InclusionGrant> => {
                this.console.log('grantSecurityClasses');
                return requested;
            },
            validateDSKAndEnterPIN: async (dsk: string) => {
                this.console.log('dsk received', dsk);
                this.log.a('Please enter the pairing DSK to confirm device enrollment.');
                return new Promise((resolve, reject) => {
                    if (this.dskDeferred) {
                        this.dskDeferred.reject(new Error('new dsk received'));
                        this.dskDeferred = undefined;
                    }
                    this.dskDeferred = {
                        resolve,
                        reject,
                    };
                });
            },
            abort: function (): void {
                this.console.log('inclusion aborted');
            }
        }
        await this.stopOperations();
        const including = await this.driver.controller.beginInclusion({
            userCallbacks,
            strategy: InclusionStrategy.Default,
        });
        this.log.a('Including devices for 5 minutes.');
        this.console.log('including', including);

        setTimeout(() => this.driver.controller.stopInclusion(), 300000);
    }

    async exclusion() {
        await this.stopOperations();
        const excluding = await this.driver.controller.beginExclusion();
        this.log.a('Excluding devices for 5 minutes.');
        this.console.log('excluding', excluding);
        setTimeout(() => this.driver.controller.stopExclusion(), 300000);
    }

    async healNetwork() {
        await this.stopOperations();
        const healing = this.controller.beginRebuildingRoutes();
        this.console.log('healing network', healing);
    }

    async putSetting(key: string, value: string | number | boolean) {
        try {
            if (key === 'inclusion') {
                this.inclusion();
                return;
            }
            if (key === 'exclusion') {
                this.exclusion();
                return;
            }
            if (key === 'confirmPin') {
                this.dskDeferred?.resolve(value.toString());
                this.dskDeferred = undefined;
                return;
            }
            if (key === 'heal') {
                this.healNetwork();
                return;
            }

            this.storage.setItem(key, value as string);

            await this.driver?.destroy();
            this.driver = undefined;
            this.startDriver();
        }
        finally {
            this.onDeviceEvent(ScryptedInterface.Settings, undefined);
        }
    }

    async discoverDevices(duration: number) {
    }

    async getDevice(nativeId: string) {
        await this.driverReady;
        return this.devices[nativeId];
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
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
        if (this.controller.nodes.get(instance.nodeId).status === NodeStatus.Dead) {
            scryptedDevice.log.a('Node is dead.');
        }
        if (!scryptedDevice) {
            scryptedDevice = new ZwaveDeviceBase(this.controller, instance);
            scryptedDevice.zwaveController = this;
            const node = instance.getNodeUnsafe();
            let name: string;
            if (node.supportsCC(CommandClasses['Node Naming and Location'])) {
                try {
                    const nodeNaming = instance.getNodeUnsafe().commandClasses["Node Naming and Location"];
                    name = await nodeNaming?.getName() || 'Z-Wave Device';
                }
                catch (e) {
                    // have seen this fail, even though it is supposedly available
                }
            }
            scryptedDevice.device = {
                name,
                interfaces: [],
                nativeId,
                type: undefined,
            };
        }

        for (let cc of instance.getSupportedCCInstances()) {
            var type = getCommandClass(cc.ccId);
            if (type) {
                this._addType(scryptedDevice, instance, type, null);
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
        scryptedDevice.device.interfaces.push(
            ScryptedInterface.Refresh,
            ScryptedInterface.Online,
            ScryptedInterface.Settings,
        );
        await deviceManager.onDeviceDiscovered(scryptedDevice.device);
        scryptedDevice.updateState();

        // todo: watch for name change and sync to zwave controller
        const node = instance.getNodeUnsafe();
        if (node.supportsCC(CommandClasses['Node Naming and Location'])) {
            try {
                const naming = instance.getNodeUnsafe().commandClasses?.['Node Naming and Location'];
                await naming?.setName(scryptedDevice.name);
            }
            catch (e) {
                // have seen this fail, even though it is supposedly available
            }
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
