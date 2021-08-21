import sdk, { Refresh, StartStop, Pause, Dock, Camera, MediaObject, ScryptedMimeTypes } from '@scrypted/sdk';
import {ScryptedDeviceBase} from '@scrypted/sdk';
import axios from 'axios';
import {Buffer} from 'buffer';
const {mediaManager} = sdk;

var botvac = require('node-botvac');
var client = new botvac.Client();

const {deviceManager, log} = sdk;

class Neato extends ScryptedDeviceBase implements Refresh, StartStop, Pause, Dock, Camera {
    refresher: Function;
    robot: any;

    constructor(nativeId, robot) {
        super(nativeId);
        this.robot = robot;

        this.refresher = (err, data) => {
            log.d(data);
            this._refresh();
        }
    }

    async getRefreshFrequency(): Promise<number> {
        return 60;
    }

    async refresh(refreshInterface, userInitiated) {
        this._refresh();
    }

    _refresh(cb?) {
        this.robot.getState((error, state) => {
            this.log.d(JSON.stringify(state));
            this.running = (state && state.state != 1) || false
            this.docked =  (state && state.details && state.details.isDocked) || false;
            this.paused = (state && state.state == 3) || false;
            this.batteryLevel = (state && state.details && state.details.charge) || 0;

            if (cb) {
                cb();
            }
        })
    }

    async start() {
        this._refresh(() => this.robot.startCleaning(this.refresher));
    }

    async dock() {
        this._refresh(() => this.robot.sendToBase(this.refresher));
    }

    async pause() {
        this._refresh(() => this.robot.pauseCleaning(this.refresher));
    }

    async stop() {
        this._refresh(() => this.robot.stopCleaning(this.refresher));
    }

    async resume() {
        this._refresh(() => this.robot.resumeCleaning(this.refresher));
    }

    async takePicture(): Promise<MediaObject> {
        const url = await new Promise<string>((resolve, reject) => {
            console.log(this.robot);
            this.robot.getMaps((err, result) => {
                const {maps } = result;
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
        
        return mediaManager.createMediaObject(url, 'image/*');
    }
}


function NeatoController() {
}

NeatoController.prototype.getDevice = function (id) {
    return this.robots && this.robots[id];
}

NeatoController.prototype.updateRobots = function (robots) {
    var interfaces = ['StartStop', 'Pause', 'Dock', 'Battery', 'Camera', 'Refresh'];

    this.robots = {};
    for (var robot of robots) {
        this.robots[robot._serial] = new Neato(robot._serial, robot);
    }

    var devices = robots.map(robot => {
        return {
            name: robot.name,
            nativeId: robot._serial,
            interfaces: interfaces,
            type: 'Vacuum',
        }
    })

    log.i(`found robots: ${JSON.stringify(devices)}`);

    deviceManager.onDevicesChanged({
        devices
    });
}

NeatoController.prototype.getOauthUrl = function () {
    var options = {
        clientId: '44f85521f7730c9f213f25f5e36f080d1e274414f6138ff23fab614faa34fd22',
        scopes: 'control_robots+maps',
        redirectUrl: 'https://home.scrypted.app/oauth/callback'
    }
    var url = "https://apps.neatorobotics.com/oauth2/authorize?client_id=" + options["clientId"] + "&scope=" + options["scopes"] + "&response_type=token&redirect_uri=" + options["redirectUrl"];

    return url;
}

function setClientToken(token) {
    client._token = token;
    client._tokenType = 'Bearer ';
}

NeatoController.prototype.onOauthCallback = function (callbackUrl) {
    var params = callbackUrl.split('#')[1].split("&");

    var token;
    var authError;
    var authErrorDescription;
    params.forEach((item, index) => {
        var key = item.split("=")[0] || "";
        var value = item.split("=")[1] || "";

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
    setClientToken(token);
    getRobots();
}

var neatoController = new NeatoController();

//authorize

function getRobots() {
    log.clearAlerts();
    //get your robots
    client.getRobots(function (error, robots) {
        if (error) {
            log.a(`Error retrieving Neato robots: ${error}`);
            throw error;
        }
        log.clearAlerts();

        var validRobots = robots
            .filter(robot => robot._serial && robot._secret);

        neatoController.updateRobots(validRobots);
    });
}

const username = localStorage.getItem('username');
const password = localStorage.getItem('password');
const token = localStorage.getItem('token');
if (token) {
    setClientToken(token);
    getRobots();
}
else if (username && password) {
    log.clearAlerts();
    client.authorize(username, password, false, function (error) {
        if (error) {
            log.a(`Error authorizing with Neato servers: ${error}`);
            throw error;
        }

        getRobots();
    });
}
else {
    log.a('You must provide "username" and "password" values in your Script Settings or use the Login button to Log in with Neato.');
}

export default neatoController;