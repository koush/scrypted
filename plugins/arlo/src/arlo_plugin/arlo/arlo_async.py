# This file has been modified to support async semantics and better
# integration with scrypted.
# Original: https://github.com/jeffreydwalter/arlo

"""
Copyright 2016 Jeffrey D. Walter

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS ISBASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
"""

# 14 Sep 2016, Len Shustek: Added Logout()
# 17 Jul 2017, Andreas Jakl: Port to Python 3 (https://www.andreasjakl.com/using-netgear-arlo-security-cameras-for-periodic-recording/)

# Import helper classes that are part of this library.

from .request import Request
from .host_picker import pick_host
from .mqtt_stream_async import MQTTStream
from .sse_stream_async import EventStream
from .logging import logger

# Import all of the other stuff.
from datetime import datetime, timedelta
from cachetools import cached, TTLCache
import scrypted_arlo_go

import asyncio
import sys
import base64
import math
import random
import time
import uuid
from urllib.parse import urlparse, parse_qs

stream_class = MQTTStream

def change_stream_class(s_class):
    global stream_class
    if s_class == "MQTT":
        stream_class = MQTTStream
    elif s_class == "SSE":
        stream_class = EventStream
    else:
        raise NotImplementedError(s_class)


# https://github.com/twrecked/pyaarlo/blob/03c99b40b67529d81c0ba399fe91a3e6d1a35a80/pyaarlo/constant.py#L265-L285
USER_AGENTS = {
    "arlo":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_2 like Mac OS X) "
        "AppleWebKit/604.3.5 (KHTML, like Gecko) Mobile/15B202 NETGEAR/v1 "
        "(iOS Vuezone)",
    "iphone":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 13_1_3 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.1 Mobile/15E148 Safari/604.1",
    "ipad":
        "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1 Mobile/15E148 Safari/604.1",
    "mac":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_6) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.1.2 Safari/605.1.15",
    "firefox":
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:85.0) "
        "Gecko/20100101 Firefox/85.0",
    "linux":
        "Mozilla/5.0 (X11; Linux x86_64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.96 Safari/537.36",

    # extracted from cloudscraper as a working UA for cloudflare
    "android":
        "Mozilla/5.0 (Linux; U; Android 8.1.0; zh-cn; PACM00 Build/O11019) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/57.0.2987.132 MQQBrowser/8.8 Mobile Safari/537.36"
}

# user agents for media players, e.g. the android app
MEDIA_USER_AGENTS = {
    "android": "ijkplayer-android-4.5_28538"
}


class Arlo(object):
    BASE_URL = 'my.arlo.com'
    AUTH_URL = 'ocapi-app.arlo.com'
    BACKUP_AUTH_HOSTS = ["NTIuMzEuMTU3LjE4MQ==","MzQuMjQ4LjE1My42OQ==","My4yNDguMTI4Ljc3","MzQuMjQ2LjE0LjI5"]
    #BACKUP_AUTH_HOSTS = BACKUP_AUTH_HOSTS[2:3]
    TRANSID_PREFIX = 'web'

    random.shuffle(BACKUP_AUTH_HOSTS)

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.event_stream = None
        self.request = None
        self.logged_in = False

    def to_timestamp(self, dt):
        if sys.version[0] == '2':
            epoch = datetime.utcfromtimestamp(0)
            return int((dt - epoch).total_seconds() * 1e3)
        else:
            return int(dt.timestamp() * 1e3)

    def genTransId(self, trans_type=TRANSID_PREFIX):
        def float2hex(f):
            MAXHEXADECIMALS = 15
            w = f // 1
            d = f % 1

            # Do the whole:
            if w == 0: result = '0'
            else: result = ''
            while w:
                w, r = divmod(w, 16)
                r = int(r)
                if r > 9: r = chr(r+55)
                else: r = str(r)
                result =  r + result

            # And now the part:
            if d == 0: return result

            result += '.'
            count = 0
            while d:
                d = d * 16
                w, d = divmod(d, 1)
                w = int(w)
                if w > 9: w = chr(w+55)
                else: w = str(w)
                result +=  w
                count += 1
                if count > MAXHEXADECIMALS: break

            return result

        now = datetime.today()
        return trans_type+"!" + float2hex(random.random() * math.pow(2, 32)).lower() + "!" + str(int((time.mktime(now.timetuple())*1e3 + now.microsecond/1e3)))

    def UseExistingAuth(self, user_id, headers):
        self.user_id = user_id
        headers['Content-Type'] = 'application/json; charset=UTF-8'
        headers['User-Agent'] = USER_AGENTS['arlo']
        self.request = Request(mode="cloudscraper")
        self.request.session.headers.update(headers)
        self.BASE_URL = 'myapi.arlo.com'
        self.logged_in = True

    def LoginMFA(self):
        device_id = str(uuid.uuid4())
        headers = {
            'DNT': '1',
            'schemaVersion': '1',
            'Auth-Version': '2',
            'Content-Type': 'application/json; charset=UTF-8',
            'Origin': f'https://{self.BASE_URL}',
            'Referer': f'https://{self.BASE_URL}/',
            'Source': 'arloCamWeb',
            'TE': 'Trailers',
            'x-user-device-id': device_id,
            'x-user-device-automation-name': 'QlJPV1NFUg==',
            'x-user-device-type': 'BROWSER',
            'Host': self.AUTH_URL,
        }

        self.request = Request()
        try:
            #raise Exception("testing backup hosts")
            auth_host = self.AUTH_URL
            self.request.options(f'https://{auth_host}/api/auth', headers=headers)
            logger.info("Using primary authentication host")
        except Exception as e:
            # in case cloudflare rejects our auth request...
            logger.warning(f"Using fallback authentication host due to: {e}")

            auth_host = pick_host([
                base64.b64decode(h.encode("utf-8")).decode("utf-8")
                for h in self.BACKUP_AUTH_HOSTS
            ], self.AUTH_URL, "/api/auth")
            logger.debug(f"Selected backup authentication host {auth_host}")

            self.request = Request(mode="ip")

        # Authenticate
        self.request.options(f'https://{auth_host}/api/auth', headers=headers)
        auth_body = self.request.post(
            f'https://{auth_host}/api/auth',
            params={
                'email': self.username,
                'password': str(base64.b64encode(self.password.encode('utf-8')), 'utf-8'),
                'language': 'en',
                'EnvSource': 'prod'
            },
            headers=headers,
            raw=True
        )
        self.user_id = auth_body['data']['userId']
        self.request.session.headers.update({'Authorization': base64.b64encode(auth_body['data']['token'].encode('utf-8')).decode()})

        # Retrieve MFA factor id
        factors_body = self.request.get(
            f'https://{auth_host}/api/getFactors',
            params={'data': auth_body['data']['issued']},
            headers=headers,
            raw=True
        )
        factor_id = next(
            iter([
                i for i in factors_body['data']['items']
                if (i['factorType'] == 'EMAIL' or i['factorType'] == 'SMS')
                and i['factorRole'] == "PRIMARY"
            ]),
            {}
        ).get('factorId')
        if not factor_id:
            raise Exception("Could not find valid 2FA method - is the primary 2FA set to either Email or SMS?")

        # Start factor auth
        start_auth_body = self.request.post(
            f'https://{auth_host}/api/startAuth',
            params={'factorId': factor_id},
            headers=headers,
            raw=True
        )
        factor_auth_code = start_auth_body['data']['factorAuthCode']

        def complete_auth(code):
            nonlocal self, factor_auth_code, headers

            finish_auth_body = self.request.post(
                f'https://{auth_host}/api/finishAuth',
                params={
                    'factorAuthCode': factor_auth_code,
                    'otp': code
                },
                headers=headers,
                raw=True
            )

            if finish_auth_body.get('data', {}).get('token') is None:
                raise Exception("Could not complete 2FA, maybe invalid token? If the error persists, please try reloading the plugin and logging in again.")

            self.request = Request(mode="cloudscraper")

            # Update Authorization code with new code
            headers = {
                'Auth-Version': '2',
                'Authorization': finish_auth_body['data']['token'],
                'User-Agent': USER_AGENTS['arlo'],
                'Content-Type': 'application/json; charset=UTF-8',
            }
            self.request.session.headers.update(headers)
            self.BASE_URL = 'myapi.arlo.com'
            self.logged_in = True

        return complete_auth

    def Logout(self):
        self.Unsubscribe()
        return self.request.put(f'https://{self.BASE_URL}/hmsweb/logout')

    async def Subscribe(self, basestation_camera_tuples=[]):
        """
        Arlo uses the EventStream interface in the browser to do pub/sub style messaging.
        Unfortunately, this appears to be the only way Arlo communicates these messages.

        This function makes the initial GET request to /subscribe, which returns the EventStream socket.
        Once we have that socket, the API requires a POST request to /notify with the subscriptions resource.
        This call registers the device (which should be the basestation) so that events will be sent to the EventStream
        when subsequent calls to /notify are made.
        """
        async def heartbeat(self, basestations, interval=30):
            while self.event_stream and self.event_stream.active:
                for basestation in basestations:
                    try:
                        self.Ping(basestation)
                    except:
                        pass
                await asyncio.sleep(interval)

        if not self.event_stream or (not self.event_stream.initializing and not self.event_stream.connected):
            self.event_stream = stream_class(self)
            await self.event_stream.start()

        while not self.event_stream.connected:
            await asyncio.sleep(0.5)

        # if tuples are provided, then this is the Subscribe initiated
        # by the top level plugin, and we should add mqtt subscriptions
        # and register basestation heartbeats
        if len(basestation_camera_tuples) > 0:
            # find unique basestations and cameras
            basestations, cameras = {}, {}
            for basestation, camera in basestation_camera_tuples:
                basestations[basestation['deviceId']] = basestation
                cameras[camera['deviceId']] = camera

            # filter out cameras without basestation, where they are their own basestations
            # this is so battery-powered devices do not drain due to pings
            # for wired devices, keep doorbells, sirens, and arloq in the list so they get pings
            # we also add arlo baby devices (abc1000, abc1000a) since they are standalone-only
            # and seem to want pings
            devices_to_ping = {}
            for basestation in basestations.values():
                if basestation['deviceId'] == basestation.get('parentId') and \
                    basestation['deviceType'] not in ['doorbell', 'siren', 'arloq', 'arloqs'] and \
                    basestation['modelId'].lower() not in ['abc1000', 'abc1000a']:
                    continue
                # avd2001 is the battery doorbell, and we don't want to drain its battery, so disable pings
                if basestation['modelId'].lower().startswith('avd2001'):
                    continue
                devices_to_ping[basestation['deviceId']] = basestation

            logger.info(f"Will send heartbeat to the following devices: {list(devices_to_ping.keys())}")

            # start heartbeat loop with only pingable devices
            asyncio.get_event_loop().create_task(heartbeat(self, list(devices_to_ping.values())))

            # subscribe to all camera topics
            topics = [
                f"d/{basestation['xCloudId']}/out/cameras/{camera['deviceId']}/#"
                for basestation, camera in basestation_camera_tuples
            ]

            # subscribe to basestation topics
            for basestation in basestations.values():
                x_cloud_id = basestation['xCloudId']
                topics += [
                    f"d/{x_cloud_id}/out/wifi/#",
                    f"d/{x_cloud_id}/out/subscriptions/#",
                    f"d/{x_cloud_id}/out/audioPlayback/#",
                    f"d/{x_cloud_id}/out/modes/#",
                    f"d/{x_cloud_id}/out/basestation/#",
                    f"d/{x_cloud_id}/out/doorbells/#",
                    f"d/{x_cloud_id}/out/siren/#",
                    f"d/{x_cloud_id}/out/devices/#",
                    f"d/{x_cloud_id}/out/storage/#",
                    f"d/{x_cloud_id}/out/schedule/#",
                    f"d/{x_cloud_id}/out/diagnostics/#",
                    f"d/{x_cloud_id}/out/automaticRevisionUpdate/#",
                    f"d/{x_cloud_id}/out/audio/#",
                    f"d/{x_cloud_id}/out/activeAutomations/#",
                    f"d/{x_cloud_id}/out/lte/#",
                ]

            self.event_stream.subscribe(topics)

    def Unsubscribe(self):
        """ This method stops the EventStream subscription and removes it from the event_stream collection. """
        if self.event_stream and self.event_stream.connected:
            self.event_stream.disconnect()
            self.request.get(f'https://{self.BASE_URL}/hmsweb/client/unsubscribe')

        self.event_stream = None

    def Notify(self, basestation, body):
        """
        The following are examples of the json you would need to pass in the body of the Notify() call to interact with Arlo:

        ##############################################################################################################################
        ##############################################################################################################################
        NOTE: While you can call Notify() directly, responses from these notify calls are sent to the EventStream (see Subscribe()),
        and so it's better to use the Get/Set methods that are implemented using the NotifyAndGetResponse() method.
        ##############################################################################################################################
        ##############################################################################################################################

        Set System Mode (Armed, Disarmed) - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"modes","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"active":"mode0"}}
        Set System Mode (Calendar) - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"schedule","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"active":true}}
        Configure The Schedule (Calendar) - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"schedule","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"schedule":[{"modeId":"mode0","startTime":0},{"modeId":"mode2","startTime":28800000},{"modeId":"mode0","startTime":64800000},{"modeId":"mode0","startTime":86400000},{"modeId":"mode2","startTime":115200000},{"modeId":"mode0","startTime":151200000},{"modeId":"mode0","startTime":172800000},{"modeId":"mode2","startTime":201600000},{"modeId":"mode0","startTime":237600000},{"modeId":"mode0","startTime":259200000},{"modeId":"mode2","startTime":288000000},{"modeId":"mode0","startTime":324000000},{"modeId":"mode0","startTime":345600000},{"modeId":"mode2","startTime":374400000},{"modeId":"mode0","startTime":410400000},{"modeId":"mode0","startTime":432000000},{"modeId":"mode0","startTime":518400000}]}
        Create Mode -
            {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"add","resource":"rules","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"name":"Record video on Camera 1 if Camera 1 detects motion","id":"ruleNew","triggers":[{"type":"pirMotionActive","deviceId":"XXXXXXXXXXXXX","sensitivity":80}],"actions":[{"deviceId":"XXXXXXXXXXXXX","type":"recordVideo","stopCondition":{"type":"timeout","timeout":15}},{"type":"sendEmailAlert","recipients":["__OWNER_EMAIL__"]},{"type":"pushNotification"}]}}
            {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"add","resource":"modes","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"name":"Test","rules":["rule3"]}}
        Delete Mode - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"delete","resource":"modes/mode3","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true}
        Camera Off - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"cameras/XXXXXXXXXXXXX","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"privacyActive":false}}
        Night Vision On - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"cameras/XXXXXXXXXXXXX","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"zoom":{"topleftx":0,"toplefty":0,"bottomrightx":1280,"bottomrighty":720},"mirror":true,"flip":true,"nightVisionMode":1,"powerSaveMode":2}}
        Motion Detection Test - {"from":"XXX-XXXXXXX_web","to":"XXXXXXXXXXXXX","action":"set","resource":"cameras/XXXXXXXXXXXXX","transId":"web!XXXXXXXX.XXXXXXXXXXXXXXXXXXXX","publishResponse":true,"properties":{"motionSetupModeEnabled":true,"motionSetupModeSensitivity":80}}

        device_id = locations.data.uniqueIds

        System Properties: ("resource":"modes")
            active (string) - Mode Selection (mode2 = All Motion On, mode1 = Armed, mode0 = Disarmed, etc.)

        System Properties: ("resource":"schedule")
            active (bool) - Mode Selection (true = Calendar)

        Camera Properties: ("resource":"cameras/{id}")
            privacyActive (bool) - Camera On/Off
            zoom (topleftx (int), toplefty (int), bottomrightx (int), bottomrighty (int)) - Camera Zoom Level
            mirror (bool) - Mirror Image (left-to-right or right-to-left)
            flip (bool) - Flip Image Vertically
            nightVisionMode (int) - Night Mode Enabled/Disabled (1, 0)
            powerSaveMode (int) - PowerSaver Mode (3 = Best Video, 2 = Optimized, 1 = Best Battery Life)
            motionSetupModeEnabled (bool) - Motion Detection Setup Enabled/Disabled
            motionSetupModeSensitivity (int 0-100) - Motion Detection Sensitivity
        """
        basestation_id = basestation.get('deviceId')

        body['transId'] = self.genTransId()
        body['from'] = self.user_id+'_web'
        body['to'] = basestation_id

        self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/notify/'+body['to'], params=body, headers={"xcloudId":basestation.get('xCloudId')})
        return body.get('transId')

    def Ping(self, basestation):
        basestation_id = basestation.get('deviceId')
        return self.Notify(basestation, {"action":"set","resource":"subscriptions/"+self.user_id+"_web","publishResponse":False,"properties":{"devices":[basestation_id]}})

    def SubscribeToErrorEvents(self, basestation, camera, callback):
        """
        Use this method to subscribe to error events. You must provide a callback function which will get called once per error event.

        The callback function should have the following signature:
        def callback(code, message)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        # Note: It looks like sometimes a message is returned as an 'is' action
        # where a 'stateChangeReason' property contains the error message. This is
        # a bit of a hack but we will listen to both events with an 'error' key as
        # well as 'stateChangeReason' events.

        def callbackwrapper(self, event):
            if 'error' in event:
                error = event['error']
            elif 'properties' in event:
                error = event['properties'].get('stateChangeReason', {})
            else:
                return None
            message = error.get('message')
            code = error.get('code')
            stop = callback(code, message)
            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, ['error', ('is', 'stateChangeReason')], callbackwrapper)
        )

    def SubscribeToMotionEvents(self, basestation, camera, callback, logger) -> asyncio.Task:
        """
        Use this method to subscribe to motion events. You must provide a callback function which will get called once per motion event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """
        return self._subscribe_to_motion_or_audio_events(basestation, camera, callback, logger, "motionDetected")

    def SubscribeToAudioEvents(self, basestation, camera, callback, logger):
        """
        Use this method to subscribe to audio events. You must provide a callback function which will get called once per audio event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """
        return self._subscribe_to_motion_or_audio_events(basestation, camera, callback, logger, "audioDetected")

    def _subscribe_to_motion_or_audio_events(self, basestation, camera, callback, logger, event_key) -> asyncio.Task:
        """
        Helper class to implement force reset of events (when event end signal is dropped) and delay of end
        of event signals (when the sensor turns off and on quickly)

        event_key is either motionDetected or audioDetected
        """

        resource = f"cameras/{camera.get('deviceId')}"

        # if we somehow miss the *Detected = False event, this task
        # is used to force the caller to register the end of the event
        force_reset_event_task: asyncio.Task = None

        # when we receive a normal *Detected = False event, this
        # task is used to delay the delivery in case the sensor
        # registers an event immediately afterwards
        delayed_event_end_task: asyncio.Task = None

        async def reset_event(sleep_duration: float) -> None:
            nonlocal force_reset_event_task, delayed_event_end_task
            await asyncio.sleep(sleep_duration)

            logger.debug(f"{event_key}: delivering False")
            callback(False)

            force_reset_event_task = None
            delayed_event_end_task = None

        def callbackwrapper(self, event):
            nonlocal force_reset_event_task, delayed_event_end_task
            properties = event.get('properties', {})

            stop = None
            if event_key in properties:
                event_detected = properties[event_key]
                delivery_delay = 10

                logger.debug(f"{event_key}: {event_detected} {'will delay delivery by ' + str(delivery_delay) + 's' if not event_detected else ''}".rstrip())

                if force_reset_event_task:
                    logger.debug(f"{event_key}: cancelling previous force reset task")
                    force_reset_event_task.cancel()
                    force_reset_event_task = None
                if delayed_event_end_task:
                    logger.debug(f"{event_key}: cancelling previous delay event task")
                    delayed_event_end_task.cancel()
                    delayed_event_end_task = None

                if event_detected:
                    stop = callback(event_detected)

                    # schedule a callback to reset the sensor
                    # if we somehow miss the *Detected = False event
                    force_reset_event_task = asyncio.get_event_loop().create_task(reset_event(60))
                else:
                    delayed_event_end_task = asyncio.get_event_loop().create_task(reset_event(delivery_delay))

            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, [('is', event_key)], callbackwrapper)
        )

    def SubscribeToBatteryEvents(self, basestation, camera, callback):
        """
        Use this method to subscribe to battery events. You must provide a callback function which will get called once per battery event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        def callbackwrapper(self, event):
            properties = event.get('properties', {})
            stop = None
            if 'batteryLevel' in properties:
                stop = callback(properties['batteryLevel'])
            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, [('is', 'batteryLevel')], callbackwrapper)
        )

    def SubscribeToDoorbellEvents(self, basestation, doorbell, callback):
        """
        Use this method to subscribe to doorbell events. You must provide a callback function which will get called once per doorbell event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """

        resource = f"doorbells/{doorbell.get('deviceId')}"

        async def unpress_doorbell(callback):
            # It's unclear what events correspond to arlo doorbell presses
            # and which ones are unpresses, so we sleep and unset after
            # a period of time
            await asyncio.sleep(1)
            callback(False)

        def callbackwrapper(self, event):
            properties = event.get('properties', {})
            stop = None
            if 'buttonPressed' in properties:
                stop = callback(properties.get('buttonPressed'))
                asyncio.get_event_loop().create_task(unpress_doorbell(callback))
            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, [('is', 'buttonPressed')], callbackwrapper)
        )

    def SubscribeToSDPAnswers(self, basestation, camera, callback):
        """
        Use this method to subscribe to pushToTalk SDP answer events. You must provide a callback function which will get called once per SDP event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """

        resource = f"cameras/{camera.get('deviceId')}"

        def callbackwrapper(self, event):
            properties = event.get("properties", {})
            stop = None
            if properties.get("type") == "answerSdp":
                stop = callback(properties.get("data"))
            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, ['pushToTalk'], callbackwrapper)
        )

    def SubscribeToCandidateAnswers(self, basestation, camera, callback):
        """
        Use this method to subscribe to pushToTalk ICE candidate answer events. You must provide a callback function which will get called once per candidate event.

        The callback function should have the following signature:
        def callback(event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.

        Returns the Task object that contains the subscription loop.
        """

        resource = f"cameras/{camera.get('deviceId')}"

        def callbackwrapper(self, event):
            properties = event.get("properties", {})
            stop = None
            if properties.get("type") == "answerCandidate":
                stop = callback(properties.get("data"))
            if not stop:
                return None
            return stop

        return asyncio.get_event_loop().create_task(
            self.HandleEvents(basestation, resource, ['pushToTalk'], callbackwrapper)
        )

    async def HandleEvents(self, basestation, resource, actions, callback):
        """
        Use this method to subscribe to the event stream and provide a callback that will be called for event event received.
        This function will allow you to potentially write a callback that can handle all of the events received from the event stream.
        """
        if not callable(callback):
            raise Exception('The callback(self, event) should be a callable function.')

        await self.Subscribe()

        async def loop_action_listener(action):
            # in this function, action can either be a tuple or a string
            # if it is a tuple, we expect there to be a property key in the tuple
            property = None
            if isinstance(action, tuple):
                action, property = action
            if not isinstance(action, str):
                raise Exception('Actions must be either a tuple or a str')

            seen_events = {}
            while self.event_stream.active:
                event, _ = await self.event_stream.get(resource, action, property, seen_events)

                if event is None or self.event_stream is None \
                    or self.event_stream.event_stream_stop_event.is_set():
                    return None

                seen_events[event.uuid] = event
                response = callback(self, event.item)

                # always requeue so other listeners can see the event too
                self.event_stream.requeue(event, resource, action, property)

                if response is not None:
                    return response

                # remove events that have expired
                for uuid in list(seen_events):
                    if seen_events[uuid].expired:
                        del seen_events[uuid]

        if self.event_stream and self.event_stream.active:
            listeners = [loop_action_listener(action) for action in actions]
            done, pending = await asyncio.wait(listeners, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            return done.pop().result()

    async def TriggerAndHandleEvent(self, basestation, resource, actions, trigger, callback):
        """
        Use this method to subscribe to the event stream and provide a callback that will be called for event event received.
        This function will allow you to potentially write a callback that can handle all of the events received from the event stream.
        NOTE: Use this function if you need to run some code after subscribing to the eventstream, but before your callback to handle the events runs.
        """
        if trigger is not None and not callable(trigger):
            raise Exception('The trigger(self, camera) should be a callable function.')
        if not callable(callback):
            raise Exception('The callback(self, event) should be a callable function.')

        await self.Subscribe()
        if trigger:
            trigger(self)

        # NOTE: Calling HandleEvents() calls Subscribe() again, which basically turns into a no-op. Hackie I know, but it cleans up the code a bit.
        return await self.HandleEvents(basestation, resource, actions, callback)

    def GetDevices(self, device_type=None, filter_provisioned=None):
        """
        This method returns an array that contains the basestation, cameras, etc. and their metadata.
        If you pass in a valid device type, as a string or a list, this method will return an array of just those devices that match that type. An example would be ['basestation', 'camera']
        To filter provisioned or unprovisioned devices pass in a True/False value for filter_provisioned. By default both types are returned.
        """
        devices = self._getDevicesImpl()
        if device_type:
            devices = [ device for device in devices if device.get('deviceType') in device_type]

        if filter_provisioned is not None:
            if filter_provisioned:
                devices = [ device for device in devices if device.get("state") == 'provisioned']
            else:
                devices = [ device for device in devices if device.get("state") != 'provisioned']

        return devices

    @cached(cache=TTLCache(maxsize=1, ttl=60))
    def _getDevicesImpl(self):
        devices = self.request.get(f'https://{self.BASE_URL}/hmsweb/v2/users/devices')
        return devices

    def GetDeviceCapabilities(self, device: dict) -> dict:
        return self._getDeviceCapabilitiesImpl(device['modelId'].lower(), device['interfaceVersion'])

    @cached(cache=TTLCache(maxsize=64, ttl=60))
    def _getDeviceCapabilitiesImpl(self, model_id: str, interface_version: str) -> dict:
        return self.request.get(
            f'https://{self.BASE_URL}/resources/capabilities/{model_id}/{model_id}_{interface_version}.json',
            raw=True
        )

    async def StartStream(self, basestation, camera, mode="rtsp", eager=True):
        """
        This function returns the url of the rtsp video stream.
        This stream needs to be called within 30 seconds or else it becomes invalid.
        It can be streamed with: ffmpeg -re -i 'rtsps://<url>' -acodec copy -vcodec copy test.mp4
        The request to /users/devices/startStream returns: { url:rtsp://<url>:443/vzmodulelive?egressToken=b<xx>&userAgent=iOS&cameraId=<camid>}

        If mode is set to "dash", returns the url to the mpd file for DASH streaming. Note that DASH
        has very specific header requirements - see GetMPDHeaders()

        If 'eager' is True, will return the stream url without waiting for Arlo to report that
        the stream has started.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        if mode not in ["rtsp", "dash"]:
            raise ValueError("mode must be 'rtsp' or 'dash'")

        # nonlocal variable hack for Python 2.x.
        class nl:
            stream_url_dict = None

        def trigger(self):
            ua = USER_AGENTS['arlo'] if mode == "rtsp" else USER_AGENTS["firefox"]
            nl.stream_url_dict = self.request.post(
                f'https://{self.BASE_URL}/hmsweb/users/devices/startStream',
                params={
                    "to": camera.get('parentId'),
                    "from": self.user_id + "_web",
                    "resource": "cameras/" + camera.get('deviceId'),
                    "action": "set",
                    "responseUrl": "",
                    "publishResponse": True,
                    "transId": self.genTransId(),
                    "properties": {
                        "activityState": "startUserStream",
                        "cameraId": camera.get('deviceId')
                    }
                },
                headers={"xcloudId":camera.get('xCloudId'), 'User-Agent': ua}
            )
            if mode == "rtsp":
                nl.stream_url_dict['url'] = nl.stream_url_dict['url'].replace("rtsp://", "rtsps://")
            else:
                nl.stream_url_dict['url'] = nl.stream_url_dict['url'].replace(":80", "")

        if eager:
            trigger(self)
            return nl.stream_url_dict['url']

        def callback(self, event):
            #return nl.stream_url_dict['url'].replace("rtsp://", "rtsps://")
            if "error" in event:
                return None
            properties = event.get("properties", {})
            if properties.get("activityState") == "userStreamActive":
                return nl.stream_url_dict['url']
            return None

        return await self.TriggerAndHandleEvent(
            basestation,
            resource,
            [("is", "activityState")],
            trigger,
            callback,
        )

    def GetMPDHeaders(self, url: str) -> dict:
        parsed = urlparse(url)
        query = parse_qs(parsed.query)

        headers = {
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
            "DNT": "1",
            "Egress-Token": query['egressToken'][0],  # this is very important
            "Origin": "https://my.arlo.com",
            "Referer": "https://my.arlo.com/",
            "User-Agent": USER_AGENTS["firefox"],
        }
        return headers

    def GetSIPInfo(self):
        resp = self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/sipInfo')
        return resp

    def GetSIPInfoV2(self, camera):
        resp = self.request.get(
            f'https://{self.BASE_URL}/hmsweb/users/devices/sipInfo/v2',
            headers={
                "xcloudId": camera.get('xCloudId'),
                "cameraId": camera.get('deviceId'),
            }
        )
        return resp

    def StartPushToTalk(self, basestation, camera):
        url = f'https://{self.BASE_URL}/hmsweb/users/devices/{self.user_id}_{camera.get("deviceId")}/pushtotalk'
        resp = self.request.get(url)
        return resp.get("uSessionId"), resp.get("data")

    def NotifyPushToTalkSDP(self, basestation, camera, uSessionId, localSdp):
        resource = f"cameras/{camera.get('deviceId')}"

        self.Notify(basestation, {
            "action": "pushToTalk",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "data": localSdp,
                "type": "offerSdp",
                "uSessionId": uSessionId
            }
        })

    def NotifyPushToTalkCandidate(self, basestation, camera, uSessionId, localCandidate):
        resource = f"cameras/{camera.get('deviceId')}"

        self.Notify(basestation, {
            "action": "pushToTalk",
            "resource": resource,
            "publishResponse": False,
            "properties": {
                "data": localCandidate,
                "type": "offerCandidate",
                "uSessionId": uSessionId
            }
        })

    async def TriggerFullFrameSnapshot(self, basestation, camera):
        """
        This function causes the camera to record a fullframe snapshot.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        def trigger(self):
            self.request.post(
                f"https://{self.BASE_URL}/hmsweb/users/devices/fullFrameSnapshot",
                params={
                    "to": camera.get("parentId"),
                    "from": self.user_id + "_web",
                    "resource": "cameras/" + camera.get("deviceId"),
                    "action": "set",
                    "publishResponse": True,
                    "transId": self.genTransId(),
                    "properties": {
                        "activityState": "fullFrameSnapshot"
                    }
                },
                headers={"xcloudId":camera.get("xCloudId")}
            )

        def callback(self, event):
            if "error" in event:
                return None
            properties = event.get("properties", {})
            url = properties.get("presignedFullFrameSnapshotUrl")
            if url:
                return url
            url = properties.get("presignedLastImageUrl")
            if url:
                return url
            return None

        return await self.TriggerAndHandleEvent(
            basestation,
            resource,
            [
                (action, property)
                for action in ["fullFrameSnapshotAvailable", "lastImageSnapshotAvailable", "is"]
                for property in ["presignedFullFrameSnapshotUrl", "presignedLastImageUrl"]
            ],
            trigger,
            callback,
        )

    def SirenOn(self, basestation, camera=None):
        if camera is not None:
            resource = f"siren/{camera.get('deviceId')}"
            return self.Notify(basestation, {
                "action": "set",
                "resource": resource,
                "publishResponse": True,
                "properties": {
                    "sirenState": "on",
                    "duration": 300,
                    "volume": 8,
                    "pattern": "alarm"
                }
            })
        return self.Notify(basestation, {
            "action": "set",
            "resource": "siren",
            "publishResponse": True,
            "properties": {
                "sirenState": "on",
                "duration": 300,
                "volume": 8,
                "pattern": "alarm"
            }
        })

    def SirenOff(self, basestation, camera=None):
        if camera is not None:
            resource = f"siren/{camera.get('deviceId')}"
            return self.Notify(basestation, {
                "action": "set",
                "resource": resource,
                "publishResponse": True,
                "properties": {
                    "sirenState": "off",
                    "duration": 300,
                    "volume": 8,
                    "pattern": "alarm"
                }
            })
        return self.Notify(basestation, {
            "action": "set",
            "resource": "siren",
            "publishResponse": True,
            "properties": {
                "sirenState": "off",
                "duration": 300,
                "volume": 8,
                "pattern": "alarm"
            }
        })

    def SpotlightOn(self, basestation, camera):
        resource = f"cameras/{camera.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "spotlight": {
                    "enabled": True,
                },
            },
        })

    def SpotlightOff(self, basestation, camera):
        resource = f"cameras/{camera.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "spotlight": {
                    "enabled": False,
                },
            },
        })

    def FloodlightOn(self, basestation, camera):
        resource = f"cameras/{camera.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "floodlight": {
                    "on": True,
                },
            },
        })

    def FloodlightOff(self, basestation, camera):
        resource = f"cameras/{camera.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "floodlight": {
                    "on": False,
                },
            },
        })

    def NightlightOn(self, basestation):
        resource = f"cameras/{basestation.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "nightLight": {
                    "enabled": True
                }
            }
        })

    def NightlightOff(self, basestation):
        resource = f"cameras/{basestation.get('deviceId')}"
        return self.Notify(basestation, {
            "action": "set",
            "resource": resource,
            "publishResponse": True,
            "properties": {
                "nightLight": {
                    "enabled": False
                }
            }
        })

    def GetLibrary(self, device, from_date: datetime, to_date: datetime):
        """
        This call returns the following:
        presignedContentUrl is a link to the actual video in Amazon AWS.
        presignedThumbnailUrl is a link to the thumbnail .jpg of the actual video in Amazon AWS.
        [
          {
            "mediaDurationSecond": 30,
            "contentType": "video/mp4",
            "name": "XXXXXXXXXXXXX",
            "presignedContentUrl": "https://arlos3-prod-z2.s3.amazonaws.com/XXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXXX/XXX-XXXXXXX/XXXXXXXXXXXXX/recordings/XXXXXXXXXXXXX.mp4?AWSAccessKeyId=XXXXXXXXXXXXXXXXXXXX&Expires=1472968703&Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            "lastModified": 1472881430181,
            "localCreatedDate": XXXXXXXXXXXXX,
            "presignedThumbnailUrl": "https://arlos3-prod-z2.s3.amazonaws.com/XXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXXX/XXX-XXXXXXX/XXXXXXXXXXXXX/recordings/XXXXXXXXXXXXX_thumb.jpg?AWSAccessKeyId=XXXXXXXXXXXXXXXXXXXX&Expires=1472968703&Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
            "reason": "motionRecord",
            "deviceId": "XXXXXXXXXXXXX",
            "createdBy": "XXXXXXXXXXXXX",
            "createdDate": "20160903",
            "timeZone": "America/Chicago",
            "ownerId": "XXX-XXXXXXX",
            "utcCreatedDate": XXXXXXXXXXXXX,
            "currentState": "new",
            "mediaDuration": "00:00:30"
          }
        ]
        """
        # give the query range a bit of buffer
        from_date_internal = from_date - timedelta(days=1)
        to_date_internal = to_date + timedelta(days=1)

        return [
            result for result in
            self._getLibraryCached(from_date_internal.strftime("%Y%m%d"), to_date_internal.strftime("%Y%m%d"))
            if result["deviceId"] == device["deviceId"]
            and datetime.fromtimestamp(int(result["name"]) / 1000.0) <= to_date
            and datetime.fromtimestamp(int(result["name"]) / 1000.0) >= from_date
        ]

    @cached(cache=TTLCache(maxsize=512, ttl=60))
    def _getLibraryCached(self, from_date: str, to_date: str):
        logger.debug(f"Library cache miss for {from_date}, {to_date}")
        return self.request.post(
            f'https://{self.BASE_URL}/hmsweb/users/library',
            params={
                'dateFrom': from_date,
                'dateTo': to_date
            }
        )

    def GetSmartFeatures(self, device) -> dict:
        smart_features = self._getSmartFeaturesCached()
        key = f"{device['owner']['ownerId']}_{device['deviceId']}"
        return smart_features["features"].get(key, {})

    @cached(cache=TTLCache(maxsize=1, ttl=60))
    def _getSmartFeaturesCached(self) -> dict:
        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/subscription/smart/features')