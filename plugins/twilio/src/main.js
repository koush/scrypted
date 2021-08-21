import axios from 'axios';
import qs from 'qs';
import sdk from '@scrypted/sdk';
const { deviceManager, log, mediaManager } = sdk;

const sid = localStorage.getItem('sid');
const token = localStorage.getItem('token');
const sender = localStorage.getItem('sender');
const numbers = (localStorage.getItem('numbers') || '').split(',').map(s => s.trim()).filter(s => s.length);

function alertAndThrow(msg) {
    log.a(msg);
    throw new Error(msg);
}

log.clearAlerts();

if (!sid || !sid.length) {
    alertAndThrow('No Account SID is configured. Enter a value for "sid" in the Script Settings.');
}

if (!token || !token.length) {
    alertAndThrow('No Auth Token is configured. Enter a value for "token" in the Script Settings.');
}

if (!sender || !sender.length) {
    alertAndThrow('No Twilio phone number is configured. Enter a value for "sender" in the Script Settings.');
}

if (!numbers.length) {
    alertAndThrow('No destination phone numbers are configured. Use "numbers" in Script Settings to provide a comma separated list of phone numbers.');
}

function TwilioNumber(number) {
    this.number = number;
}

// implementation of Notifier

TwilioNumber.prototype.sendNotification = function (arg0, arg1) {
    console.log('sendNotification was called!');
};

TwilioNumber.prototype.postTwilio = function (body) {
    return axios.post(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        qs.stringify(body),
        {
            headers: {
                'Content-type': 'application/x-www-form-urlencoded',
            },
            auth: {
                username: sid,
                password: token
            }
        })
        .then(() => {
            log.i('Message sent.');
        })
        .catch((e) => {
            log.e(`Failed to send message ${e}`);
        });
}

TwilioNumber.prototype.sendNotification = function (title, body, media, mimeType) {
    console.log('sendNotification (media) was called!');

    const postBody = {
        From: sender,
        Body: body,
        To: this.number,
    };

    if (!media) {
        return this.postTwilio(postBody);
    }

    // the mediaConvert variable is provided by Scrypted and can be used to convert
    // MediaObjects into other objects.
    // For example, a MediaObject from a RTSP camera can be converted to an externally
    // accessible Uri png image using this code.
    mediaManager.convertMediaObjectToUri(media, mimeType)
    .then(result => {
        postBody['MediaUrl'] = result.toString();
        this.postTwilio(postBody);
    });

    // for example, if you wanted to send the message body as a audio file,
    // use this code instead.
    // under the hood, Android is using the text to speech engine to convert
    // the message body to an audio file, and then hosting the audio file
    // as an externally accessible Uri that Twilio can reach.

    // mediaManager.convertMediaObjectToUri(body, 'text/string')
    // .then(result => {
    //     postBody['MediaUrl'] = result.toString();
    //     this.postTwilio(postBody);
    // });
};

function Twilio() {
    setImmediate(() => {
        var devices = numbers.map(number => ({
            name: number,
            nativeId: number,
            type: 'Notifier',
            interfaces: ['Notifier'],
        }));

        deviceManager.onDevicesChanged({
            devices,
        });
    });
}

Twilio.prototype.getDevice = function (id) {
    if (numbers.indexOf(id) == -1)
        return null;
    return new TwilioNumber(id);
}

export default new Twilio();
