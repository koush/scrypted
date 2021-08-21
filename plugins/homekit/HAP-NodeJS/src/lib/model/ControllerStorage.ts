import {MacAddress} from "../../types";
import util from "util";
import createDebug from "debug";
import {ControllerIdentifier, SerializableController} from "../controller";
import {Accessory} from "../Accessory";
import { HAPStorage } from "./HAPStorage";


const debug = createDebug("HAP-NodeJS:ControllerStorage");

interface StorageLayout {
    accessories: Record<string, StoredControllerData[]>, // indexed by accessory UUID
}

interface StoredControllerData {
    type: ControllerIdentifier, // this field is called type out of history
    controllerData: ControllerData,
}

interface ControllerData {
    data: any,
    /*
    This property and the exact sequence this property is accessed solves the following problems:
      - Orphaned ControllerData won't be there forever and gets cleared at some point
      - When storage is loaded, there is no fixed time frame after which Controllers need to be configured
     */
    purgeOnNextLoad?: boolean,
}

export class ControllerStorage {

    private readonly accessoryUUID: string;
    private initialized: boolean = false;

    // ----- properties only set in parent storage object ------
    private username?: MacAddress;
    private fileCreated: boolean = false;
    purgeUnidentifiedAccessoryData: boolean = true;
    // ---------------------------------------------------------

    private trackedControllers: SerializableController[] = []; // used to track controllers before data was loaded from disk
    private controllerData: Record<ControllerIdentifier, ControllerData> = {};
    private restoredAccessories?: Record<string, StoredControllerData[]>; // indexed by accessory UUID

    private parent?: ControllerStorage;
    private linkedAccessories?: ControllerStorage[];

    private queuedSaveTimeout?: NodeJS.Timeout;
    private queuedSaveTime?: number;

    public constructor(accessory: Accessory) {
        this.accessoryUUID = accessory.UUID;
    }

    private enqueueSaveRequest(timeout: number = 0): void {
        if (this.parent) {
            this.parent.enqueueSaveRequest(timeout);
            return;
        }

        const plannedTime = Date.now() + timeout;

        if (this.queuedSaveTimeout) {
            if (plannedTime <= (this.queuedSaveTime ?? 0)) {
                return;
            }

            clearTimeout(this.queuedSaveTimeout);
        }

        this.queuedSaveTimeout = setTimeout(() => {
            this.queuedSaveTimeout = this.queuedSaveTime = undefined;
            this.save();
        }, timeout).unref();
        this.queuedSaveTime = Date.now() + timeout;
    }

    /**
     * Links a bridged accessory to the ControllerStorage of the bridge accessory.
     *
     * @param accessory
     */
    public linkAccessory(accessory: Accessory) {
        if (!this.linkedAccessories) {
            this.linkedAccessories = [];
        }

        const storage = accessory.controllerStorage;
        this.linkedAccessories.push(storage);
        storage.parent = this;

        const saved = this.restoredAccessories && this.restoredAccessories[accessory.UUID];
        if (this.initialized) {
            storage.init(saved);
        }
    }

    public trackController(controller: SerializableController) {
        controller.setupStateChangeDelegate(this.handleStateChange.bind(this, controller)); // setup delegate

        if (!this.initialized) { // track controller if data isn't loaded yet
            this.trackedControllers.push(controller);
        } else {
            this.restoreController(controller);
        }
    }

    public untrackController(controller: SerializableController) {
        const index = this.trackedControllers.indexOf(controller);
        if (index !== -1) { // remove from trackedControllers if storage wasn't initialized yet
            this.trackedControllers.splice(index, 1);
        }

        controller.setupStateChangeDelegate(undefined); // remove associating with this storage object

        this.purgeControllerData(controller);
    }

    public purgeControllerData(controller: SerializableController) {
        delete this.controllerData[controller.controllerId()];

        if (this.initialized) {
            this.enqueueSaveRequest(100);
        }
    }

    private handleStateChange(controller: SerializableController) {
        const id = controller.controllerId();
        const serialized = controller.serialize();

        if (!serialized) { // can be undefined when controller wishes to delete data
            delete this.controllerData[id];
        } else {
            let controllerData = this.controllerData[id];

            if (!controllerData) {
                this.controllerData[id] = {
                    data: serialized,
                };
            } else {
                controllerData.data = serialized;
            }
        }

        if (this.initialized) { // only save if data was loaded
            // run save data "async", as handleStateChange call will probably always be caused by a http request
            // this should improve our response time
            this.enqueueSaveRequest(100);
        }
    }


    private restoreController(controller: SerializableController) {
        if (!this.initialized) {
            throw new Error("Illegal state. Controller data wasn't loaded yet!");
        }

        const controllerData = this.controllerData[controller.controllerId()];
        if (controllerData) {
            try {
                controller.deserialize(controllerData.data);
            } catch (error) {
                console.warn(`Could not initialize controller of type '${controller.controllerId()}' from data stored on disk. Resetting to default: ${error.stack}`);
                controller.handleFactoryReset();
            }
            controllerData.purgeOnNextLoad = undefined;
        }
    }

    /**
     * Called when this particular Storage object is feed with data loaded from disk.
     * This method is only called once.
     *
     * @param data - array of {@link StoredControllerData}. undefined if nothing was stored on disk for this particular storage object
     */
    private init(data?: StoredControllerData[]) {
        if (this.initialized) {
            throw new Error(`ControllerStorage for accessory ${this.accessoryUUID} was already initialized!`);
        }
        this.initialized = true;

        // storing data into our local controllerData Record
        data && data.forEach(saved => this.controllerData[saved.type] = saved.controllerData);

        const restoredControllers: ControllerIdentifier[] = [];
        this.trackedControllers.forEach(controller => {
            this.restoreController(controller);
            restoredControllers.push(controller.controllerId());
        });
        this.trackedControllers.splice(0, this.trackedControllers.length); // clear tracking list

        let purgedData = false;
        Object.entries(this.controllerData).forEach(([id, data]) => {
            if (data.purgeOnNextLoad) {
                delete this.controllerData[id];
                purgedData = true;
                return;
            }

            if (!restoredControllers.includes(id)) {
                data.purgeOnNextLoad = true;
            }
        });

        if (purgedData) {
            this.enqueueSaveRequest(500);
        }
    }

    public load(username: MacAddress) { // will be called once accessory gets published
        if (this.username) {
            throw new Error("ControllerStorage was already loaded!");
        }
        this.username = username;

        const key = ControllerStorage.persistKey(username);
        const saved: StorageLayout | undefined = HAPStorage.storage().getItem(key);

        let ownData;
        if (saved) {
            this.fileCreated = true;

            ownData = saved.accessories[this.accessoryUUID];
            delete saved.accessories[this.accessoryUUID];
        }

        this.init(ownData);

        if (this.linkedAccessories) {
            this.linkedAccessories.forEach(linkedStorage => {
                const savedData = saved && saved.accessories[linkedStorage.accessoryUUID];
                linkedStorage.init(savedData);

                if (saved) {
                    delete saved.accessories[linkedStorage.accessoryUUID];
                }
            });
        }

        if (saved && Object.keys(saved.accessories).length > 0) {
            if (!this.purgeUnidentifiedAccessoryData) {
                this.restoredAccessories = saved.accessories; // save data for controllers which aren't linked yet
            } else {
                debug("Purging unidentified controller data for bridge %s", username);
            }
        }
    }

    public save() {
        if (this.parent) {
            this.parent.save();
            return;
        }

        if (!this.initialized) {
            throw new Error("ControllerStorage has not yet been loaded!");
        }
        if (!this.username) {
            throw new Error("Cannot save controllerData for a storage without a username!");
        }

        const accessories: Record<string, Record<ControllerIdentifier, ControllerData>> = {
            [this.accessoryUUID]: this.controllerData,
        };
        if (this.linkedAccessories) { // grab data from all linked storage objects
            this.linkedAccessories.forEach(accessory => accessories[accessory.accessoryUUID] = accessory.controllerData);
        }

        // TODO removed accessories won't ever be deleted?
        const accessoryData: Record<string, StoredControllerData[]> = this.restoredAccessories || {};
        Object.entries(accessories).forEach(([uuid, controllerData]) => {
            const entries = Object.entries(controllerData);

            if (entries.length > 0) {
                accessoryData[uuid] = entries.map(([id, data]) => ({
                    type: id,
                    controllerData: data,
                }));
            }
        });

        const key = ControllerStorage.persistKey(this.username);
        if (Object.keys(accessoryData).length > 0) {
            const saved: StorageLayout = {
                accessories: accessoryData,
            };

            this.fileCreated = true;
            HAPStorage.storage().setItemSync(key, saved);
        } else if (this.fileCreated) {
            this.fileCreated = false;
            HAPStorage.storage().removeItemSync(key);
        }
    }

    static persistKey(username: MacAddress) {
        return util.format("ControllerStorage.%s.json", username.replace(/:/g, "").toUpperCase());
    }

    static remove(username: MacAddress) {
        const key = ControllerStorage.persistKey(username);
        HAPStorage.storage().removeItemSync(key);
    }

}
