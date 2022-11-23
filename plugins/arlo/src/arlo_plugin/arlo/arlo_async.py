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
from .mqtt_stream_async import MQTTStream
from .sse_stream_async import EventStream
from .logging import logger
    
# Import all of the other stuff.
from datetime import datetime

import asyncio
import sys
import base64
import math
import random
import time

stream_class = MQTTStream

def change_stream_class(s_class):
    global stream_class
    if s_class == "MQTT":
        stream_class = MQTTStream
    elif s_class == "SSE":
        stream_class = EventStream
    else:
        raise NotImplementedError(s_class)

class Arlo(object):
    BASE_URL = 'my.arlo.com'
    AUTH_URL = 'ocapi-app.arlo.com'
    TRANSID_PREFIX = 'web'

    def __init__(self, username, password):
        self.username = username
        self.password = password
        self.event_stream = None
        self.request = Request()

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
        self.request.session.headers.update(headers)
        self.BASE_URL = 'myapi.arlo.com'

    def LoginMFA(self):
        self.request = Request()

        headers = {
            'DNT': '1',
            'schemaVersion': '1',
            'Auth-Version': '2',
            'Content-Type': 'application/json; charset=UTF-8',
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_2 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Mobile/15B202 NETGEAR/v1 (iOS Vuezone)',
            'Origin': f'https://{self.BASE_URL}',
            'Referer': f'https://{self.BASE_URL}/',
            'Source': 'arloCamWeb',
            'TE': 'Trailers',
        }

        # Authenticate
        auth_body = self.request.post(
            f'https://{self.AUTH_URL}/api/auth',
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
            f'https://{self.AUTH_URL}/api/getFactors',
            params={'data': auth_body['data']['issued']},
            headers=headers,
            raw=True
        )
        factor_id = next(
            i for i in factors_body['data']['items']
            if (i['factorType'] == 'EMAIL' or i['factorType'] == 'SMS')
            and i['factorRole'] == "PRIMARY"
        )['factorId']

        # Start factor auth
        start_auth_body = self.request.post(
            f'https://{self.AUTH_URL}/api/startAuth',
            {'factorId': factor_id},
            headers=headers,
            raw=True
        )
        factor_auth_code = start_auth_body['data']['factorAuthCode']

        def complete_auth(code):
            nonlocal self, factor_auth_code, headers

            finish_auth_body = self.request.post(
                f'https://{self.AUTH_URL}/api/finishAuth',
                {
                    'factorAuthCode': factor_auth_code,
                    'otp': code
                },
                headers=headers,
                raw=True
            )

            # Update Authorization code with new code
            headers = {
                'Auth-Version': '2',
                'Authorization': finish_auth_body['data']['token'],
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 11_1_2 like Mac OS X) AppleWebKit/604.3.5 (KHTML, like Gecko) Mobile/15B202 NETGEAR/v1 (iOS Vuezone)',
            }
            self.request.session.headers.update(headers)
            self.BASE_URL = 'myapi.arlo.com'

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
            while self.event_stream and self.event_stream.connected:
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
            # for now, keep doorbells in the list so they get pings
            proper_basestations = {}
            for basestation in basestations.values():
                if basestation['deviceId'] == basestation.get('parentId') and basestation['deviceType'] not in ['doorbell', 'siren']:
                    continue
                proper_basestations[basestation['deviceId']] = basestation

            logger.info(f"Will send heartbeat to the following basestations: {list(proper_basestations.keys())}")

            # start heartbeat loop with only basestations
            asyncio.get_event_loop().create_task(heartbeat(self, list(proper_basestations.values())))

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
            self.request.get(f'https://{self.BASE_URL}/hmsweb/client/unsubscribe')
            self.event_stream.disconnect()

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

        self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/notify/'+body['to'], body, headers={"xcloudId":basestation.get('xCloudId')})
        return body.get('transId')

    def Ping(self, basestation):
        basestation_id = basestation.get('deviceId')
        return self.Notify(basestation, {"action":"set","resource":"subscriptions/"+self.user_id+"_web","publishResponse":False,"properties":{"devices":[basestation_id]}})

    def SubscribeToMotionEvents(self, basestation, camera, callback):
        """
        Use this method to subscribe to motion events. You must provide a callback function which will get called once per motion event.

        The callback function should have the following signature:
        def callback(self, event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        def callbackwrapper(self, event):
            properties = event.get('properties', {})
            stop = None
            if 'motionDetected' in properties:
                stop = callback(properties['motionDetected'])
            if not stop:
                return None
            return stop

        asyncio.get_event_loop().create_task(self.HandleEvents(basestation, resource, ['is'], callbackwrapper))

    def SubscribeToBatteryEvents(self, basestation, camera, callback):
        """
        Use this method to subscribe to battery events. You must provide a callback function which will get called once per battery event.

        The callback function should have the following signature:
        def callback(self, event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.
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

        asyncio.get_event_loop().create_task(self.HandleEvents(basestation, resource, ['is'], callbackwrapper))

    def SubscribeToDoorbellEvents(self, basestation, doorbell, callback):
        """
        Use this method to subscribe to doorbell events. You must provide a callback function which will get called once per doorbell event.

        The callback function should have the following signature:
        def callback(self, event)

        This is an example of handling a specific event, in reality, you'd probably want to write a callback for HandleEvents()
        that has a big switch statement in it to handle all the various events Arlo produces.
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

        asyncio.get_event_loop().create_task(self.HandleEvents(basestation, resource, ['is'], callbackwrapper))

    async def HandleEvents(self, basestation, resource, actions, callback):
        """
        Use this method to subscribe to the event stream and provide a callback that will be called for event event received.
        This function will allow you to potentially write a callback that can handle all of the events received from the event stream.
        """
        if not callable(callback):
            raise Exception('The callback(self, event) should be a callable function.')

        await self.Subscribe()
        if self.event_stream and self.event_stream.connected:
            seen_events = {}
            while self.event_stream.connected:
                event, action = await self.event_stream.get(resource, actions, seen_events)

                if event is None or self.event_stream is None \
                    or self.event_stream.event_stream_stop_event.is_set():
                    return None

                seen_events[event.uuid] = event
                response = callback(self, event.item)

                # always requeue so other listeners can see the event too
                self.event_stream.requeue(event, resource, action)

                if response is not None:
                    return response

                # remove events that have expired
                for uuid in list(seen_events):
                    if seen_events[uuid].expired:
                        del seen_events[uuid]

    async def TriggerAndHandleEvent(self, basestation, resource, actions, trigger, callback):
        """
        Use this method to subscribe to the event stream and provide a callback that will be called for event event received.
        This function will allow you to potentially write a callback that can handle all of the events received from the event stream.
        NOTE: Use this function if you need to run some code after subscribing to the eventstream, but before your callback to handle the events runs.
        """
        if not callable(trigger):
            raise Exception('The trigger(self, camera) should be a callable function.')
        if not callable(callback):
            raise Exception('The callback(self, event) should be a callable function.')

        await self.Subscribe()
        trigger(self)

        # NOTE: Calling HandleEvents() calls Subscribe() again, which basically turns into a no-op. Hackie I know, but it cleans up the code a bit.
        return await self.HandleEvents(basestation, resource, actions, callback)

    def GetDevices(self, device_type=None, filter_provisioned=None):
        """
        This method returns an array that contains the basestation, cameras, etc. and their metadata.
        If you pass in a valid device type, as a string or a list, this method will return an array of just those devices that match that type. An example would be ['basestation', 'camera']
        To filter provisioned or unprovisioned devices pass in a True/False value for filter_provisioned. By default both types are returned.
        """
        devices = self.request.get(f'https://{self.BASE_URL}/hmsweb/v2/users/devices')
        if device_type:
            devices = [ device for device in devices if device.get('deviceType') in device_type]

        if filter_provisioned is not None:
            if filter_provisioned:
                devices = [ device for device in devices if device.get("state") == 'provisioned']
            else:
                devices = [ device for device in devices if device.get("state") != 'provisioned']

        return devices

    async def StartStream(self, basestation, camera):
        """
        This function returns the url of the rtsp video stream.
        This stream needs to be called within 30 seconds or else it becomes invalid.
        It can be streamed with: ffmpeg -re -i 'rtsps://<url>' -acodec copy -vcodec copy test.mp4
        The request to /users/devices/startStream returns: { url:rtsp://<url>:443/vzmodulelive?egressToken=b<xx>&userAgent=iOS&cameraId=<camid>}
        """
        stream_url_dict = self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/startStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"startUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId":camera.get('xCloudId')})
        return stream_url_dict['url'].replace("rtsp://", "rtsps://")

    def StopStream(self, basestation, camera):
        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/stopStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"stopUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId": camera.get('xCloudId')})

    async def TriggerFullFrameSnapshot(self, basestation, camera):
        """
        This function causes the camera to record a fullframe snapshot.
        The presignedFullFrameSnapshotUrl url is returned.
        Use DownloadSnapshot() to download the actual image file.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        def trigger(self):
            self.request.post(f"https://{self.BASE_URL}/hmsweb/users/devices/fullFrameSnapshot", {"to":camera.get("parentId"),"from":self.user_id+"_web","resource":"cameras/"+camera.get("deviceId"),"action":"set","publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"fullFrameSnapshot"}}, headers={"xcloudId":camera.get("xCloudId")})

        def callback(self, event):
            properties = event.get("properties", {})
            url = properties.get("presignedFullFrameSnapshotUrl")
            if url:
                return url
            url = properties.get("presignedLastImageUrl")
            if url:
                return url
            return None

        return await self.TriggerAndHandleEvent(basestation, resource, ["fullFrameSnapshotAvailable", "lastImageSnapshotAvailable", "is"], trigger, callback)
