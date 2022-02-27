import sdk, { Refresh, StartStop, Pause, Dock, Camera, MediaObject, ScryptedMimeTypes, PictureOptions, DeviceProvider, DeviceDiscovery, ScryptedInterface, Device } from '@scrypted/sdk';
import { ScryptedDeviceBase } from '@scrypted/sdk';
import axios from 'axios';
import throttle from 'lodash/throttle';

const botvac = require('node-botvac');

const { mediaManager } = sdk;

const { deviceManager, log } = sdk;

class Neato extends ScryptedDeviceBase implements Refresh, StartStop, Pause, Dock, Camera {
    robot: any;

    constructor(nativeId: string, robot: any) {
        super(nativeId);
        this.robot = robot;
    }

    refreshThrottled = throttle(() => {
        this.refresh(undefined, undefined);
    }, 10000);

    async pollChanges() {
        for (let i = 0; i < 20; i++) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            this.refreshThrottled();
        }
    }

    async getPictureOptions(): Promise<PictureOptions[]> {
        return;
    }

    async getRefreshFrequency(): Promise<number> {
        return 60;
    }

    async refresh(refreshInterface: string, userInitiated: boolean) {
        this.robot.getState((error: Error, state: any) => {
            this.console.log('state', state);
            this.running = (state && state.state != 1) || false
            this.docked = (state && state.details && state.details.isDocked) || false;
            this.paused = (state && state.state == 3) || false;
            this.batteryLevel = (state && state.details && state.details.charge) || 0;
        });
    }

    async start() {
        this.robot.startCleaning(1);
        this.pollChanges();
    }

    async dock() {
        this.robot.sendToBase();
        this.pollChanges();
    }

    async pause() {
        this.robot.pauseCleaning();
        this.pollChanges();
    }

    async stop() {
        this.robot.stopCleaning();
        this.pollChanges();
    }

    async resume() {
        this.robot.resumeCleaning();
        this.pollChanges();
    }

    async takePicture(): Promise<MediaObject> {
        const url = await new Promise<string>((resolve, reject) => {
            console.log(this.robot);
            this.robot.getMaps((err, result) => {
                const { maps } = result;
                if (err) {
                    reject(new Error(JSON.stringify(err)));
                    return;
                }
                if (!maps || !maps.length) {
                    reject(new Error('no maps found'));
                    return;
                }
                resolve(maps[0].url);
            })
        });

        const response = await axios(url, {
            responseType: 'arraybuffer',
        });
        return mediaManager.createMediaObject(Buffer.from(response.data), 'image/jpeg');
    }
}


class NeatoController extends ScryptedDeviceBase implements DeviceProvider, DeviceDiscovery {
    client = new botvac.Client();
    robots = new Map<string, Neato>();

    constructor() {
        super();

        const username = this.storage.getItem('username');
        const password = this.storage.getItem('password');
        const token = this.storage.getItem('token');
        if (token) {
            this.setClientToken(token);
            this.discoverDevices();
        }
        else if (username && password) {
            log.clearAlerts();
            this.client.authorize(username, password, false, (error: Error) => {
                if (error) {
                    log.a(`Error authorizing with Neato servers: ${error}`);
                    throw error;
                }

                this.discoverDevices();
            });
        }
        else {
            log.a('Use the Login button to sync your Neato vacuums.');
        }
    }

    async discoverDevices(duration?: number) {
        log.clearAlerts();
        //get your robots
        this.client.getRobots((error: Error, robots: any) => {
            if (error) {
                this.console.error('Error retrieving Neato robots', error);
                throw error;
            }
            log.clearAlerts();

            const validRobots = robots
                .filter((robot: any) => robot._serial && robot._secret);

            this.updateRobots(validRobots);
        });
    }

    getDevice(nativeId: string) {
        return this.robots.get(nativeId);
    }

    updateRobots(robots: any) {
        const interfaces = [
            ScryptedInterface.StartStop,
            ScryptedInterface.Pause,
            ScryptedInterface.Dock,
            ScryptedInterface.Battery,
            ScryptedInterface.Camera,
            ScryptedInterface.Refresh
        ];

        for (const robot of robots) {
            this.robots.set(robot._serial, new Neato(robot._serial, robot));
        }

        const devices = robots.map(robot => {
            return {
                name: robot.name,
                nativeId: robot._serial,
                interfaces: interfaces,
                type: 'Vacuum',
                info: {
                    manufacturer: 'Neato Robotics',
                    serialNumber: robot._serial,
                }
            } as Device
        })

        deviceManager.onDevicesChanged({
            devices
        });
    }

    getOauthUrl() {
        const options = {
            clientId: '44f85521f7730c9f213f25f5e36f080d1e274414f6138ff23fab614faa34fd22',
            scopes: 'control_robots+maps',
            redirectUrl: 'https://home.scrypted.app/oauth/callback'
        }
        const url = "https://apps.neatorobotics.com/oauth2/authorize?client_id=" + options["clientId"] + "&scope=" + options["scopes"] + "&response_type=token&redirect_uri=" + options["redirectUrl"];

        return url;
    }

    setClientToken(token) {
        this.client._token = token;
        this.client._tokenType = 'Bearer ';
    }

    onOauthCallback(callbackUrl) {
        const params = callbackUrl.split('#')[1].split("&");

        let token: string;
        let authError: string;
        let authErrorDescription: string;
        params.forEach((item: string) => {
            const key = item.split("=")[0] || "";
            const value = item.split("=")[1] || "";

            if (key.localeCompare("access_token") == 0) {
                token = value;
            }
            else if (key.localeCompare("error") == 0) {
                authError = value;
            }
            else if (key.localeCompare("error_description") == 0) {
                authErrorDescription = value.replace(/\+/g, " ");
            }
        });

        if (authError) {
            log.a(`There was an error logging in with Neato: ${authError} ${authErrorDescription}`);
            return;
        }

        localStorage.setItem('token', token);
        this.setClientToken(token);
        this.discoverDevices();
    }
}

export default new NeatoController();
