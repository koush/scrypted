import { TemperatureUnit } from '@scrypted/sdk';
import axios from 'axios';

/**
 * Represents the state of the air conditioner,
 * the valid values for most of these options are enumerated in remoteCapabilities.
 */
 export interface AcState {
    on?: boolean;
    mode?: string;
    targetTemperature?: number;
    /**
     * 'C' for Celcius or 'F' for Farenheit.
     */
    temperatureUnit?: string;
    fanLevel?: string;
    swing?: string;
    horizontalSwing?: string;
    light?: string;
}

/**
 * Configuration options for the 'Climate React' system, which turns the AC on/off when
 * a certain temperature or humidity threshold is reached.
 */
 export interface SmartMode {
    enabled?: boolean;
    /**
     * The type of measurement to monitor, one of "temperature", "humidity" or "feelsLike".
     */
    type?: string;
    /**
     * The low threshold, acState will be set to lowTemperatureState when the selected sensor
     * drops below this threshold (despite the name, this value is used for humidity as well).
     */
    lowTemperatureThreshold?: number;
    /**
     * The high threshold, acState will be set to highTemperatureState when the selected sensor
     * rises above this threshold (despite the name, this value is used for humidity as well).
     */
    highTemperatureThreshold?: number;
    lowTemperatureState?: AcState;
    highTemperatureState?: AcState;
}

/**
 * Measurements recorded by the sensors in the Sensibo Pod.
 */
interface Measurements {
    temperature?: number;
    humidity?: number;
}

/**
 * Details for the room-level location of the Sensibo Pod.
 */
interface Room {
    name: string;
}

/**
 * Set of valid temperature values for a given mode, as supported by the emulated remote.
 */
interface TemperatureOptions {
    isNative?: boolean;
    values?: number[];
}

/**
 * Set of valid configutation options for a given mode, as supported by the emulated remote.
 */
interface ModeCapabilities {
    temperatures?: { [temperatureUnit: string]: TemperatureOptions }
    fanLevels?: string[];
    swing?: string[];
    horizontalSwing?: string[];
    light?: string[];
}

/**
 * Configuration options supported by the emulated remote.
 */
interface RemoteCapabilities {
    modes?: { [mode: string]: ModeCapabilities };
}

/**
 * Information about the Sensibo Pod.
 */
interface PodInfo {
    id: string;
    productModel: string;
    firmwareType: string;
    firmwareVersion: string;
    serial: string;
    macAddress: string;
    room: Room;
    acState: AcState;
    measurements: Measurements;
    smartMode: SmartMode;
    remoteCapabilities: RemoteCapabilities;
    remoteFlavor: string;
}

export class SensiboPod {
    apiKey: string;

    podInfo: PodInfo;
    // nextAcState acts as a delta on currentAcState, storing only the settings which should be
    // updated on currentAcState next time the state is pushed - preserving changes made by the
    // Sensibo app or AC remote.
    currentAcState: AcState;
    nextAcState: AcState;
    // nextSmartMode replaces the whole smartMode configuration if set - reflecting how the smartmode
    // endpoint works. currentSmartMode will be 'null' if no temperature thresholds are set, since
    // that's what the API returns when this is the case.
    currentSmartMode?: SmartMode;
    nextSmartMode?: SmartMode;
    measurements: Measurements;
    remoteFlavor: string;

    constructor(apiKey: string, podInfo: PodInfo) {
        this.apiKey = apiKey;
        this.podInfo = podInfo;
        this.currentAcState = podInfo.acState ?? {} as AcState;
        this.nextAcState = {} as AcState;
        this.currentSmartMode = podInfo.smartMode;
        this.nextSmartMode = null;
        this.measurements = podInfo.measurements;
        this.remoteFlavor = podInfo.remoteFlavor;
    }

    async _pushAcState() : Promise<void> {
        const delta = this.nextAcState;
        this.nextAcState = {} as AcState;
        // Don't push the state delta if it's empty, since any POST request to the API
        // seems to trigger an IR command from the pod (and beep from the AC) - even if
        // there's no actual change made to the AC state.
        if (delta && Object.keys(delta).length === 0) {
            return;
        }
        // I'm assuming here that the POST requests will be sent out in the same order
        // that axios.post is called, so no locking mechanism is needed to protect this API endpoint.
        const res = await axios.post(
            `https://home.sensibo.com/api/v2/pods/${this.podInfo.id}/acStates?apiKey=${this.apiKey}`,
            { "acState": delta }
        ).catch(function (error) {
            if (error.response) {
                return error.response;
            } else {
                console.error(`Error whilst writing pod AcState (No response from server, Message: ${error.message})`);
                throw error;
            }
        });
        if (!res.data) {
            console.error(`Error whilst writing pod AcState (Empty response from server, HTTP Status: ${res.status})`);
        } else if (res.data.status != "success") {
            console.error(`Error whilst writing pod AcState (HTTP Status: ${res.status}, API Status: ${res.data.status}, Reason: ${res.data.reason}, Message: ${res.data.message})`);
        }
    }

    async _pushSmartMode() : Promise<void> {
        if (!this.nextSmartMode) {
            return;
        }
        const nextSmartMode = this.nextSmartMode;
        this.nextSmartMode = null;
        // See the comment on axios.post in _pushAcMode.
        const res = await axios.post(
            `https://home.sensibo.com/api/v2/pods/${this.podInfo.id}/smartmode?apiKey=${this.apiKey}`,
            nextSmartMode
        ).catch(function (error) {
            if (error.response) {
                return error.response;
            } else {
                console.error(`Error whilst writing pod SmartMode (No response from server, Message: ${error.message})`);
                throw error;
            }
        });
        if (!res.data) {
            console.error(`Error whilst writing pod SmartMode (No response from server, HTTP Status: ${res.status})`);
        } else if (res.data.status != "success") {
            console.error(`Error whilst writing pod SmartMode (HTTP Status: ${res.status}, API Status: ${res.data.status}, Reason: ${res.data.reason}, Message: ${res.data.message})`);
        }
    }

    async _pullAll() : Promise<void> {
        const res = await axios.get(
            `https://home.sensibo.com/api/v2/pods/${this.podInfo.id}?fields=acState,smartMode,measurements,remoteFlavor&apiKey=${this.apiKey}`
        ).catch(function (error) {
            if (error.response) {
                return error.response;
            } else {
                console.error(`Error whilst reading pod state (No response from server, Message: ${error.message})`);
                throw error;
            }
        });
        if (!res.data) {
            console.error(`Error whilst reading pod state (No response from server, HTTP Status: ${res.status})`);
            return;
        } else if (res.data.status != "success") {
            console.error(`Error whilst reading pod state (HTTP Status: ${res.status}, API Status: ${res.data.status}, Reason: ${res.data.reason}, Message: ${res.data.message})`);
            return;
        }
        this.currentAcState = res.data.result.acState ?? {} as AcState;
        this.currentSmartMode = res.data.result.smartMode ?? {} as SmartMode;
        this.measurements = res.data.result.measurements;
        this.remoteFlavor = res.data.result.remoteFlavor;
    }

    async sync() : Promise<void> {
        await this._pushAcState();
        await this._pushSmartMode();
        await this._pullAll();
    }
}

export class SensiboAPI {
    apiKey: string;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async discoverPods() : Promise<SensiboPod[]> {
        const res = await axios.get(
            `https://home.sensibo.com/api/v2/users/me/pods?fields=id,productModel,firmwareType,firmwareVersion,serial,macAddress,room,acState,measurements,smartMode,remoteCapabilities,remoteFlavor&apiKey=${this.apiKey}`
        ).catch(function (error) {
            if (error.response) {
                return error.response;
            } else {
                console.error(`Error whilst discovering pods (No response from server, Message: ${error.message})`);
                throw error;
            }
        });
        if (!res.data) {
            console.error(`Error whilst discovering pods (No response from server, HTTP Status: ${res.status})`);
            return;
        } else if (res.data.status != "success") {
            console.error(`Error whilst discovering pods (HTTP Status: ${res.status}, API Status: ${res.data.status}, Reason: ${res.data.reason}, Message: ${res.data.message})`);
            return;
        }
        // We only support the Sensibo air conditioners, so filter out anything that's not a Sensibo Sky, Air or derivative thereof
        return res.data.result.filter((podInfo: PodInfo) => podInfo.productModel.includes('sky') || podInfo.productModel.includes('air'))
            .map((podInfo: PodInfo) => new SensiboPod(this.apiKey, podInfo));
    }
}