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
from .eventstream_async import EventStream
from .logging import logger
    
# Import all of the other stuff.
from datetime import datetime

import asyncio
import sys
import base64
import math
import random
import time

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
        if not self.event_stream or (not self.event_stream.initializing and not self.event_stream.connected):
            self.event_stream = EventStream(self)
            await self.event_stream.start()

        while not self.event_stream.connected:
            await asyncio.sleep(0.5)

        # subscribe to all camera topics
        topics = [
            f"d/{basestation['xCloudId']}/out/cameras/{camera['deviceId']}/#"
            for basestation, camera in basestation_camera_tuples
        ]

        # find unique basestations and subscribe to basestation topics
        basestations = {}
        for basestation, _ in basestation_camera_tuples:
            basestations[basestation['deviceId']] = basestation
        for basestation in basestations.values():
            x_cloud_id = basestation['xCloudId']
            topics += [
                f"d/{x_cloud_id}/out/wifi/#",
                f"d/{x_cloud_id}/out/subscriptions/#",
                f"d/{x_cloud_id}/out/audioPlayback/#",
                f"d/{x_cloud_id}/out/modes/#",
                f"d/{x_cloud_id}/out/basestation/#",
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

                if event is None or self.event_stream.event_stream_stop_event.is_set():
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

#    def GetBaseStationState(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"basestation","publishResponse":False})
#
#    def GetCameraState(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"cameras","publishResponse":False})
#
#    def GetRules(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"rules","publishResponse":False})
#
#    def GetSmartFeatures(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/subscription/smart/features')
#
#    def GetSmartAlerts(self, camera):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/'+camera.get('uniqueId')+'/smartalerts')
#
#    def GetAutomationActivityZones(self, camera):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/'+camera.get('uniqueId')+'/activityzones')
#
#    def RestartBasestation(self, basestation):
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/restart', {"deviceId":basestation.get('deviceId')})
#
#    def SetAutomationActivityZones(self, camera, zone, coords, color):
#        """
#        An activity zone is the area you draw in your video in the UI to tell Arlo what part of the scene to "watch".
#        This method takes 4 arguments.
#        camera: the camera you want to set an activity zone for.
#        name: "Zone 1" - the name of your activity zone.
#        coords: [{"x":0.37946943483275664,"y":0.3790983606557377},{"x":0.8685121107266436,"y":0.3790983606557377},{"x":0.8685121107266436,"y":1},{"x":0.37946943483275664,"y":1}] - these coordinates are the bonding box for the activity zone.
#        color: 45136 - the color for your bounding box.
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/'+camera.get('uniqueId')+'/activityzones', {"name": zone,"coords": coords, "color": color})
#
#    def GetAutomationDefinitions(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/automation/definitions', {'uniqueIds':'all'})
#
#    def GetCalendar(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"schedule","publishResponse":False})
#
#    def DeleteMode(self, device, mode):
#        """ device can be any object that has parentId == deviceId. i.e., not a camera """
#        parentId = device.get('parentId', None)
#        if device.get('deviceType') == 'arlobridge':
#            return self.request.delete(f'https://{self.BASE_URL}/hmsweb/users/locations/'+device.get('uniqueId')+'/modes/'+mode)
#        elif not parentId or device.get('deviceId') == parentId:
#            return self.NotifyAndGetResponse(device, {"action":"delete","resource":"modes/"+mode,"publishResponse":True})
#        else:
#            raise Exception('Only parent device modes and schedules can be deleted.')
#
#    def GetModes(self, basestation):
#        """ DEPRECATED: This is the older API for getting the "mode". It still works, but GetModesV2 is the way the Arlo software does it these days. """
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"modes","publishResponse":False})
#
#    def GetModesV2(self):
#        """
#        This is the newer API for getting the "mode". This method also returns the schedules.
#        Set a non-schedule mode to be active: {"activeAutomations":[{"deviceId":"XXXXXXXXXXXXX","timestamp":1532015622105,"activeModes":["mode1"],"activeSchedules":[]}]}
#        Set a schedule to be active: {"activeAutomations":[{"deviceId":"XXXXXXXXXXXXX","timestamp":1532015790139,"activeModes":[],"activeSchedules":["schedule.1"]}]}
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/automation/active')
#
#    def CustomMode(self, device, mode, schedules=[]):
#        """ device can be any object that has parentId == deviceId. i.e., not a camera """
#        parentId = device.get('parentId', None)
#        if device.get('deviceType') == 'arlobridge':
#            return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/automation/active', {'activeAutomations':[{'deviceId':device.get('deviceId'),'timestamp':self.to_timestamp(datetime.now()),'activeModes':[mode],'activeSchedules':schedules}]})
#        elif not parentId or device.get('deviceId') == parentId:
#            return self.NotifyAndGetResponse(device, {"from":self.user_id+"_web", "to": device.get("parentId"), "action":"set","resource":"modes", "transId": self.genTransId(),"publishResponse":True,"properties":{"active":mode}})
#        else:
#            raise Exception('Only parent device modes and schedules can be modified.')
#
#    def Arm(self, device):
#        return self.CustomMode(device, "mode1")
#
#    def Disarm(self, device):
#        return self.CustomMode(device, "mode0")
#
#    def Calendar(self, basestation, active=True):
#        """
#        DEPRECATED: This API appears to still do stuff, but I don't see it called in the web UI anymore when switching the mode to a schedule.
#
#        NOTE: The Arlo API seems to disable calendar mode when switching to other modes, if it's enabled.
#        You should probably do the same, although, the UI reflects the switch from calendar mode to say armed mode without explicitly setting calendar mode to inactive.
#        """
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"schedule","publishResponse":True,"properties":{"active":active}})
#
#    def SetSchedule(self, basestation, schedule):
#        """
#        The following json is what was sent to the API when I edited my schedule. It contains all of the data necessary to configure a whole week. It's a little convoluted, but you can just play around with the scheduler in Chrome and watch the schema that gets sent.
#
#        {
#          "schedule": [
#            {
#              "duration": 600,
#              "startActions": {
#                "disableModes": [
#                  "mode0"
#                ],
#                "enableModes": [
#                  "mode1"
#                ]
#              },
#              "days": [
#                "Mo",
#                "Tu",
#                "We",
#                "Th",
#                "Fr",
#                "Sa",
#                "Su"
#              ],
#              "startTime": 0,
#              "type": "weeklyAction",
#              "endActions": {
#                "disableModes": [
#                  "mode1"
#                ],
#                "enableModes": [
#                  "mode0"
#                ]
#              }
#            },
#            {
#              "duration": 360,
#              "startActions": {
#                "disableModes": [
#                  "mode0"
#                ],
#                "enableModes": [
#                  "mode2"
#                ]
#              },
#              "days": [
#                "Mo",
#                "Tu",
#                "We",
#                "Th",
#                "Fr",
#                "Sa",
#                "Su"
#              ],
#              "startTime": 1080,
#              "type": "weeklyAction",
#              "endActions": {
#                "disableModes": [
#                  "mode2"
#                ],
#                "enableModes": [
#                  "mode0"
#                ]
#              }
#            },
#            {
#              "duration": 480,
#              "startActions": {
#                "disableModes": [
#                  "mode0"
#                ],
#                "enableModes": [
#                  "mode3"
#                ]
#              },
#              "days": [
#                "Tu"
#              ],
#              "startTime": 600,
#              "type": "weeklyAction",
#              "endActions": {
#                "disableModes": [
#                  "mode3"
#                ],
#                "enableModes": [
#                  "mode0"
#                ]
#              }
#            }
#          ],
#          "name": "",
#          "id": "schedule.1",
#          "enabled": true
#        }
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/locations/'+basestation.get('uniqueId')+'/schedules', )
#
#    def AdjustBrightness(self, basestation, camera, brightness=0):
#        """
#        NOTE: Brightness is between -2 and 2 in increments of 1 (-2, -1, 0, 1, 2).
#        Setting it to an invalid value has no effect.
#
#        Returns:
#        {
#          "action": "is",
#          "from": "XXXXXXXXXXXXX",
#          "properties": {
#              "brightness": -2
#          },
#          "resource": "cameras/XXXXXXXXXXXXX",
#          "to": "336-XXXXXXX_web",
#          "transId": "web!XXXXXXXX.389518!1514956240683"
#        }
#        """
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+camera.get('deviceId'),"publishResponse":True,"properties":{"brightness":brightness}})
#
#    def ToggleCamera(self, basestation, camera, active=True):
#        """
#        active: True - Camera is off.
#        active: False - Camera is on.
#        """
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+camera.get('deviceId'),"publishResponse":True,"properties":{"privacyActive":active}})
#
#    def PushToTalk(self, camera):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/'+camera.get('uniqueId')+'/pushtotalk')
#
#    """ General alert toggles """
#    def SetMotionAlertsOn(self, basestation, sensitivity=5):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"motionDetection":{"armed":True,"sensitivity":sensitivity,"zones":[]}}})
#
#    def SetMotionAlertsOff(self, basestation, sensitivity=5):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"motionDetection":{"armed":False,"sensitivity":sensitivity,"zones":[]}}})
#
#    def SetAudioAlertsOn(self, basestation, sensitivity=3):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"audioDetection":{"armed":True,"sensitivity":sensitivity}}})
#
#    def SetAudioAlertsOff(self, basestation, sensitivity=3):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"audioDetection":{"armed":False,"sensitivity":sensitivity}}})
#
#    def AlertNotificationMethods(self, basestation, action="disabled", email=False, push=False):
#        """ action : disabled OR recordSnapshot OR recordVideo """
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"eventAction":{"actionType":action,"stopType":"timeout","timeout":15,"emailNotification":{"enabled":email,"emailList":["__OWNER_EMAIL__"]},"pushNotification":push}}})
#
#    """ Arlo Baby Audio Control """
#    def GetAudioPlayback(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"audioPlayback","publishResponse":False})
#
#    def PlayTrack(self, basestation, track_id="2391d620-e491-4412-99f6-e9a40d6046ed", position=0):
#        """
#        Defaulting to 'hugh little baby', which is a supplied track. I hope the ID is the same for all
#        """
#        return self.Notify(basestation, {"action":"playTrack","resource":"audioPlayback/player","properties":{"trackId":track_id,"position":position}})
#
#    def PauseTrack(self, basestation):
#        return self.Notify(basestation, {"action":"pause","resource":"audioPlayback/player"})
#
#    def UnPauseTrack(self, basestation):
#        return self.Notify(basestation, {"action":"play","resource":"audioPlayback/player"})
#
#    def SkipTrack(self, basestation):
#        return self.Notify(basestation, {"action":"nextTrack","resource":"audioPlayback/player"})
#
#    def SetSleepTimerOn(self, basestation, time=calendar.timegm(time.gmtime()) + 300, timediff=0):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"sleepTime":time,"sleepTimeRel":timediff}}})
#
#    def SetSleepTimerOff(self, basestation, time=0, timediff=300):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"sleepTime": time,"sleepTimeRel":timediff}}})
#
#    def SetLoopBackModeContinuous(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"loopbackMode":"continuous"}}})
#
#    def SetLoopBackModeSingleTrack(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"loopbackMode":"singleTrack"}}})
#
#    def SetShuffleOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"shuffleActive":True}}})
#
#    def SetShuffleOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"audioPlayback/config","publishResponse":True,"properties":{"config":{"shuffleActive":False}}})
#
#    def SetVolume(self, basestation, mute=False, volume=50):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"speaker":{"mute":mute,"volume":volume}}})
#
#    """  Baby Arlo Nightlight, (current state is in the arlo.GetCameraState(cameras[0]["properties"][0]["nightLight"]) """
#    def SetNightLightOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"enabled":True}}})
#
#    def SetNightLightOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"enabled":False}}})
#
#    def SetNightLightBrightness(self, basestation, level=200):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"brightness":level}}})
#
#    def SetNightLightMode(self, basestation, mode="rainbow"):
#        """ mode: rainbow or rgb. """
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"mode":mode}}})
#
#    def SetNightLightColor(self, basestation, red=255, green=255, blue=255):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"rgb":{"blue":blue,"green":green,"red":red}}}})
#
#    def SetNightLightTimerOn(self, basestation, time=calendar.timegm(time.gmtime()) + 300, timediff=0):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"sleepTime":time,"sleepTimeRel":timediff}}})
#
#    def SetNightLightTimerOff(self, basestation, time=0, timediff=300):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId'),"publishResponse":True,"properties":{"nightLight":{"sleepTime":time,"sleepTimeRel":timediff}}})
#
#    """ Baby Arlo Sensors """
#    def GetCameraTempReading(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/history","publishResponse":False})
#
#    def GetSensorConfig(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"get","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":False})
#
#    def SetAirQualityAlertOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"alertsEnabled":True}}})
#
#    def SetAirQualityAlertOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"alertsEnabled":False}}})
#
#    def SetAirQualityAlertThresholdMin(self, basestation, number=400):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"minThreshold":number}}})
#
#    def SetAirQualityAlertThresholdMax(self, basestation, number=700):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"maxThreshold":number}}})
#
#    def SetAirQualityRecordingOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"recordingEnabled":True}}})
#
#    def SetAirQualityRecordingOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"airQuality":{"recordingEnabled":False}}})
#
#    def SetHumidityAlertOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"alertsEnabled":True}}})
#
#    def SetHumidityAlertOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"alertsEnabled":False}}})
#
#    def SetHumidityAlertThresholdMin(self, basestation, number=400):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"minThreshold":number}}})
#
#    def SetHumidityAlertThresholdMax(self, basestation, number=800):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"maxThreshold":number}}})
#
#    def SetHumidityRecordingOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"recordingEnabled":True}}})
#
#    def SetHumidityRecordingOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"humidity":{"recordingEnabled":False}}})
#
#    def SetTempAlertOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"alertsEnabled":True}}})
#
#    def SetTempAlertOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"alertsEnabled":False}}})
#
#    def SetTempAlertThresholdMin(self, basestation, number=200):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"minThreshold":number}}})
#
#    def SetTempAlertThresholdMax(self, basestation, number=240):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"maxThreshold":number}}})
#
#    def SetTempRecordingOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"recordingEnabled":True}}})
#
#    def SetTempRecordingOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"cameras/"+basestation.get('deviceId')+"/ambientSensors/config","publishResponse":True,"properties":{"temperature":{"recordingEnabled":False}}})
#
#    def SetTempUnit(self, uniqueId, unit="C"):
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/'+uniqueId+'/tempUnit', {"tempUnit":unit})
#
#    def SirenOn(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"siren","publishResponse":True,"properties":{"sirenState":"on","duration":300,"volume":8,"pattern":"alarm"}})
#
#    def SirenOff(self, basestation):
#        return self.NotifyAndGetResponse(basestation, {"action":"set","resource":"siren","publishResponse":True,"properties":{"sirenState":"off","duration":300,"volume":8,"pattern":"alarm"}})
#
#    def Reset(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/library/reset')
#
#    def GetServiceLevelSettings(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/serviceLevel/settings')
#
#    def GetServiceLevel(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/serviceLevel')
#
#    def GetServiceLevelV2(self):
#        """ DEPRECATED: This API still works, but I don't see it being called in the web UI anymore. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/serviceLevel/v2')
#
#    def GetServiceLevelV3(self):
#        """ DEPRECATED: This API still works, but I don't see it being called in the web UI anymore. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/serviceLevel/v3')
#
#    def GetServiceLevelV4(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/serviceLevel/v4')
#
#    def GetUpdateFeatures(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/updateFeatures/feature')
#
#    def GetPaymentBilling(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/payment/billing/'+self.user_id)
#
#    def GetPaymentOffers(self):
#        """ DEPRECATED: This API still works, but I don't see it being called in the web UI anymore. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/payment/offers')
#
#    def GetPaymentOffersV2(self):
#        """ DEPRECATED: This API still works, but I don't see it being called in the web UI anymore. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/payment/offers/v2')
#
#    def GetPaymentOffersV3(self):
#        """ DEPRECATED: This API still works, but I don't see it being called in the web UI anymore. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/payment/offers/v3')
#
#    def GetPaymentOffersV4(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/payment/offers/v4')
#
#    def SetOCProfile(self, firstName, lastName, country='United States', language='en', spam_me=0):
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/ocprofile', {"firstName":"Jeffrey","lastName":"Walter","country":country,"language":language,"mailProgram":spam_me})
#
#    def GetOCProfile(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/ocprofile')
#
#    def GetProfile(self):
#        """
#        This call returns the following:
#        {
#          "data": {
#              "_type": "User",
#              "firstName": "Joe",
#              "lastName": "Bloggs",
#              "language": "en",
#              "country": "GB",
#              "acceptedPolicy": 1,
#              "currentPolicy": 1,
#              "validEmail": true
#          },
#          "success": true
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/profile')
#
#    def GetAccount(self):
#        """
#        This call returns the following:
#        {
#          "data": {
#            "userId": "XXX-XXXXXXX",
#            "email": "joe.bloggs@gmail.com",
#            "dateCreated": 1585157000819,
#            "dateDeviceRegistered": 1585161139527,
#            "countryCode": "GB",
#            "language": "en-gb",
#            "firstName": "Joe",
#            "lastName": "Bloggs",
#            "s3StorageId": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
#            "tosVersion": "5",
#            "tosAgreeDate": 1593126066795,
#            "tosShownVersion": "5",
#            "lastModified": 1585161137898,
#            "accountStatus": "registered",
#            "paymentId": "xxxxxxxx",
#            "serialNumber": "xxxxxxxxxxxxx",
#            "mobilePushData": {
#                "mobilePushOsMap": {
#                    "android": [
#                        {
#                            "token": "xxxxxxxxxxxxxxxxxxx",
#                            "endpoint": "arn:aws:sns:eu-west-1:xxxxxxxxxxxx:endpoint/GCM/Arlo_Android_Prod/xxxxxxxxxxxxxxxxxxxxxx",
#                            "createdDate": "20201310_0622",
#                            "iosDebugModeFlag": false
#                        },
#                        {
#                            "token": "xxxxxxxxxxxxxxxxxxxx",
#                            "endpoint": "arn:aws:sns:eu-west-1:xxxxxxxxxxxx:endpoint/GCM/Arlo_Android_Prod/xxxxxxxxxxxxxxxxxxxxxxx",
#                            "createdDate": "20210801_0335",
#                            "iosDebugModeFlag": false
#                        }
#                    ]
#                }
#            },
#            "recycleBinQuota": 0,
#            "favoriteQuota": 0,
#            "validEmail": true,
#            "locationCreated": false,
#            "readyToClose": false,
#            "lastMessageTimeToBS": 1608375685602
#          },
#          "success": true
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/account')
#
#    def GetSession(self):
#        """
#        Returns something like the following:
#        {
#          "userId": "XXX-XXXXXXX",
#          "email": "jeffreydwalter@gmail.com",
#          "token": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
#          "paymentId": "XXXXXXXX",
#          "accountStatus": "registered",
#          "serialNumber": "XXXXXXXXXXXXXX",
#          "countryCode": "US",
#          "tocUpdate": false,
#          "policyUpdate": false,
#          "validEmail": true,
#          "arlo": true,
#          "dateCreated": 1463975008658
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/session')
#
#    def GetSessionV2(self):
#        """
#        Returns something like the following:
#        {
#          "userId": "XXX-XXXXXXX",
#          "email": "jeffreydwalter@gmail.com",
#          "token": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
#          "paymentId": "XXXXXXXX",
#          "accountStatus": "registered",
#          "serialNumber": "XXXXXXXXXXXXXX",
#          "countryCode": "US",
#          "tocUpdate": false,
#          "policyUpdate": false,
#          "validEmail": true,
#          "arlo": true,
#          "dateCreated": 1463975008658
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/session/v2')
#
#    def GetFriends(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/friends')
#
#    def GetLocations(self):
#        """
#        This call returns the following:
#        {
#          "id":"XXX-XXXXXXX_20160823042047",
#          "name":"Home",
#          "ownerId":"XXX-XXXXXXX",
#          "longitude":X.XXXXXXXXXXXXXXXX,
#          "latitude":X.XXXXXXXXXXXXXXXX,
#          "address":"123 Middle Of Nowhere Bumbfuck, EG, 12345",
#          "homeMode":"schedule",
#          "awayMode":"mode1",
#          "geoEnabled":false,
#          "geoRadius":150.0,
#          "uniqueIds":[
#             "XXX-XXXXXXX_XXXXXXXXXXXXX"
#          ],
#          "smartDevices":[
#             "XXXXXXXXXX",
#             "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
#          ],
#          "pushNotifyDevices":[
#             "XXXXXXXXXX"
#          ]
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/locations')
#
#    def GetEmergencyLocations(self):
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/emergency/locations')
#
#    def Geofencing(self, location_id, active=True):
#        """
#        Get location_id is the id field from the return of GetLocations()
#        NOTE: The Arlo API seems to disable geofencing mode when switching to other modes, if it's enabled.
#        You should probably do the same, although, the UI reflects the switch from calendar mode to say armed mode without explicitly setting calendar mode to inactive.
#        """
#        return self.request.put(f'https://{self.BASE_URL}/hmsweb/users/locations/'+location_id, {'geoEnabled':active})
#
#    def GetDevice(self, device_name):
#        def is_device(device):
#            return device.get('deviceName') == device_name
#        return list(filter(is_device, self.GetDevices()))[0]

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

#    def GetDeviceSupport(self):
#        """
#        DEPRECATED: This API still works, but I don't see it being called in the web UI anymore.
#
#        This API looks like it's mainly used by the website, but I'm including it for completeness sake.
#        It returns something like the following:
#        {
#          "devices": [
#            {
#              "deviceType": "arloq",
#              "urls": {
#                "troubleshoot": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/pc_troubleshoot.html",
#                "plugin": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/pc_plugin.html",
#                "connection": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/pc_connection.html",
#                "connectionFailed": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/pc_connection_fail.html",
#                "press_sync": "https://vzs3-prod-common.s3. amazonaws.com/static/html/en/pc_press_sync.html",
#                "resetDevice": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/reset_arloq.html",
#                "qr_how_to": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/pc_qr_how_to.html"
#              }
#            },
#            {
#              "deviceType": "basestation",
#              "urls": {
#                "troubleshoot": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/bs_troubleshoot.html",
#                "connection": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/bs_connection.html",
#                "sync": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/bs_sync_camera.html"
#              }
#            },
#            {
#              "deviceType": "arloqs",
#              "urls": {
#                "ethernetSetup": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/ethernet_setup.html",
#                "plugin": "https://    vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/aqp_plugin.html",
#                "connectionWiFi": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/connection_in_progress_wifi.html",
#                "poeSetup": "https://vzs3-prod-common.s3.       amazonaws.com/static/html/en/arloqs/poe_setup.html",
#                "connection": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/connection_in_progress.html",
#                "connectionFailed": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/connection_fail.html",
#                "press_sync": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/press_sync.html",
#                "connectionType": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/connection_type.html",
#                "resetDevice": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/reset_device.html",
#                "qr_how_to": "https://vzs3-prod-common.s3.amazonaws.com/static/html/en/arloqs/qr_how_to.html"
#              }
#            }
#          ]
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/devicesupport')
#
#    def GetDeviceSupportv2(self):
#        """
#        DEPRECATED: This API still works, but I don't see it being called in the web UI anymore.
#
#        It returns something like the following:
#        {
#          "devices": [
#            {
#              "deviceType": "arloq",
#              "modelId": [
#                "VMC3040"
#              ],
#              "urls": {
#                "troubleshoot": "arloq/troubleshoot.html",
#                "plugin": "arloq/plugin.html",
#                "qrHowTo": "arloq/qrHowTo.html",
#                "connection": "arloq/connection.html",
#                "connectionInProgress": "arloq/connectionInProgress.html",
#                "connectionFailed": "arloq/connectionFailed.html",
#                "pressSync": "arloq/pressSync.html",
#                "resetDevice": "arloq/resetDevice.html"
#              }
#            },
#            {
#              "deviceType": "basestation",
#              "modelId": [
#                "VMB3010",
#                "VMB3010r2",
#                "VMB3500",
#                "VMB4000",
#                "VMB4500",
#                "VZB3010"
#              ],
#              "urls": {
#                "troubleshoot": "basestation/troubleshoot.html",
#                "plugin": "basestation/plugin.html",
#                "sync3": "basestation/sync3.html",
#                "troubleshootBS": "basestation/troubleshootBS.html",
#                "connection": "basestation/connection.html",
#                "connectionInProgress": "basestation/connectionInProgress.html",
#                "sync2": "basestation/sync2.html",
#                "connectionFailed": "basestation/connectionFailed.html",
#                "sync1": "basestation/sync1.html",
#                "resetDevice": "basestation/resetDevice.html",
#                "syncComplete": "basestation/syncComplete.html"
#              }
#            },
#            {
#              "deviceType": "arlobaby",
#              "modelId": [
#                "ABC1000"
#              ],
#              "urls": {
#                "bleSetupError": "arlobaby/bleSetupError.html",
#                "troubleshoot": "arlobaby/troubleshoot.html",
#                "homekitCodeInstruction": "arlobaby/homekitCodeInstruction.html",
#                "connectionInProgress": "arlobaby/connectionInProgress.html",
#                "connectionFailed": "arlobaby/connectionFailed.html",
#                "resetDevice": "arlobaby/resetDevice.html",
#                "plugin": "arlobaby/plugin.html",
#                "qrHowTo": "arlobaby/qrHowTo.html",
#                "warning": "arlobaby/warning.html",
#                "connection": "arlobaby/connection.html",
#                "pressSync": "arlobaby/pressSync.html",
#                "bleInactive": "arlobaby/bleInactive.html",
#                "pluginIOS": "arlobaby/pluginIOS.html",
#                "homekitSetup": "arlobaby/homekitSetup.html"
#              }
#            },
#            {
#              "deviceType": "lteCamera",
#              "modelId": [
#                "VML4030"
#              ],
#              "urls": {
#                "troubleshoot": "lteCamera/troubleshoot.html",
#                "resetHowTo": "lteCamera/resetHowTo.html",
#                "plugin": "lteCamera/plugin.html",
#                "qrHowTo": "lteCamera/qrHowTo.html",
#                "connectionInProgress": "lteCamera/connectionInProgress.html",
#                "connectionFailed": "lteCamera/connectionFailed.html",
#                "resetDevice": "lteCamera/resetHowTo.html",
#                "resetComplete": "lteCamera/resetComplete.html",
#                "syncComplete": "lteCamera/syncComplete.html"
#              }
#            },
#            {
#              "deviceType": "arloqs",
#              "modelId": [
#                "VMC3040S"
#              ],
#              "urls": {
#                "ethernetSetup": "arloqs/ethernetSetup.html",
#                "troubleshoot": "arloqs/troubleshoot.html",
#                "plugin": "arloqs/plugin.html",
#                "poeSetup": "arloqs/poeSetup.html",
#                "connectionInProgressWiFi": "arloqs/connectionInProgressWifi.html",
#                "qrHowTo": "arloqs/qrHowTo.html",
#                "connectionInProgress": "arloqs/connectionInProgress.html",
#                "connectionFailed": "arloqs/connectionFailed.html",
#                "pressSync": "arloqs/pressSync.html",
#                "connectionType": "arloqs/connectionType.html",
#                "resetDevice": "arloqs/resetDevice.html"
#              }
#            },
#            {
#              "deviceType": "bridge",
#              "modelId": [
#                "ABB1000"
#              ],
#              "urls": {
#                "troubleshoot": "bridge/troubleshoot.html",
#                "fwUpdateInProgress": "bridge/fwUpdateInProgress.html",
#                "qrHowToUnplug": "bridge/qrHowToUnplug.html",
#                "fwUpdateDone": "bridge/fwUpdateDone.html",
#                "fwUpdateAvailable": "bridge/fwUpdateAvailable.html",
#                "needHelp": "https://www.arlo.com/en-us/support/#support_arlo_light",
#                "wifiError": "bridge/wifiError.html",
#                "bleAndroid": "bridge/bleInactiveAND.html",
#                "bleIOS": "bridge/bleInactiveIOS.html",
#                "connectionInProgress": "bridge/connectionInProgress.html",
#                "connectionFailed": "bridge/connectionFailed.html",
#                "manualPair": "bridge/manualPairing.html",
#                "resetDevice": "bridge/resetDevice.html",
#                "lowPower": "bridge/lowPowerZoneSetup.html",
#                "fwUpdateFailed": "bridge/fwUpdateFailed.html",
#                "fwUpdateCheckFailed": "bridge/fwUpdateCheckFailed.html",
#                "plugin": "bridge/plugin.html",
#                "qrHowTo": "bridge/qrHowTo.html",
#                "pressSync": "bridge/pressSync.html",
#                "pluginNoLED": "bridge/pluginNoLED.html",
#                "fwUpdateCheck": "bridge/fwUpdateCheck.html"
#              }
#            },
#            {
#              "deviceType": "lights",
#              "modelId": [
#                "AL1101"
#              ],
#              "urls": {
#                "troubleshoot": "lights/troubleshoot.html",
#                "needHelp": "https://kb.netgear.com/000053159/Light-discovery-failed.html",
#                "bleInactiveAND": "lights/bleInactiveAND.html",
#                "connectionInProgress": "lights/connectionInProgress.html",
#                "connectionFailed": "lights/connectionFailed.html",
#                "addBattery": "lights/addBattery.html",
#                "tutorial1": "lights/tutorial1.html",
#                "plugin": "lights/plugin.html",
#                "tutorial2": "lights/tutorial2.html",
#                "tutorial3": "lights/tutorial3.html",
#                "configurationInProgress": "lights/configurationInProgress.html",
#                "qrHowTo": "lights/qrHowTo.html",
#                "pressSync": "lights/pressSync.html",
#                "bleInactiveIOS": "lights/bleInactiveIOS.html",
#                "syncComplete": "lights/syncComplete.html"
#              }
#            },
#            {
#              "deviceType": "routerM1",
#              "modelId": [
#                "MR1100"
#              ],
#              "urls": {
#                "troubleshoot": "routerM1/troubleshoot.html",
#                "help": "routerM1/help.html",
#                "pairingFailed": "routerM1/pairingFailed.html",
#                "needHelp": "https://acupdates.netgear.com/help/redirect.aspx?url=m1arlo-kbb",
#                "plugin": "routerM1/plugin.html",
#                "pairing": "routerM1/pairing.html",
#                "connectionInProgress": "routerM1/connectionInProgress.html",
#                "sync2": "routerM1/sync2.html",
#                "connectionFailed": "routerM1/connectionFailed.html",
#                "sync1": "routerM1/sync1.html",
#                "sync": "routerM1/sync.html",
#                "syncComplete": "routerM1/syncComplete.html"
#              }
#            }
#          ],
#          "selectionUrls": {
#            "addDevice": "addDeviceBsRuAqAqpLteAbcMrBgLt.html",
#            "selectBasestation": "selectBsMr.html",
#            "deviceSelection": "deviceBsAqAqpLteAbcMrLtSelection.html",
#            "selectLights": "selectBgLt.html"
#          },
#          "baseUrl": "https://vzs3-prod-common.s3.amazonaws.com/static/v2/html/en/"
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/devicesupport/v2')
#
#    def GetDeviceSupportV3(self):
#        """
#        This is the latest version of the device support api.
#        It returns something like the following:
#        {
#          "data": {
#            "devices": {
#              "camera": {
#                "modelIds": [
#                  "VMC3010",
#                  "VMC3030",
#                  "VMC4030",
#                  "VMC4030P",
#                  "VMC5040",
#                  "VZC3010",
#                  "VZC3030"
#                ],
#                "connectionTypes": {
#                  "WPS": true,
#                  "BLE": true
#                },
#                "kbArticles": {
#                  "insertBatteries": "https://kb.arlo.com/980150/Safety-Rules-for-Arlo-Wire-Free-Camera-Batteries",
#                  "syncBasestation": "https://kb.arlo.com/987/How-do-I-set-up-and-sync-my-Arlo-Wire-Free-cameras",
#                  "sync": "https://kb.arlo.com/987/How-do-I-set-up-and-sync-my-Arlo-Wire-Free-camera",
#                  "firmwareUpdate": "https://kb.arlo.com/4736/How-do-I-update-my-Arlo-firmware-manually"
#                }
#              },
#              "arloq": {
#                "modelIds": [
#                  "VMC3040",
#                  "VMC3040S"
#                ],
#                "kbArticles": {
#                  "power": "https://kb.arlo.com/1001944/How-do-I-set-up-Arlo-Q-on-iOS",
#                  "qrCode": "https://kb.arlo.com/1001944/How-do-I-set-up-Arlo-Q-on-iOS",
#                  "power_android": "https://kb.arlo.com/1002006/How-do-I-set-up-Arlo-Q-on-Android",
#                  "qrCode_android":  "https://kb.arlo.com/1002006/How-do-I-set-up-Arlo-Q-on-Android"
#                }
#              },
#              "basestation": {
#                "modelIds": [
#                  "VMB3010",
#                  "VMB4000",
#                  "VMB3010r2",
#                  "VMB3500",
#                  "VZB3010",
#                  "VMB4500",
#                  "VMB5000"
#                ],
#                "smartHubs": [
#                  "VMB5000"
#                ],
#                "kbArticles": {
#                  "pluginNetworkCable": "https://kb.arlo.com/1179139/How-do-I-connect-my-Arlo-or-Arlo-Pro-base-station-to-the-Internet",
#                  "power": "https://kb.arlo.com/1179139/How-do-I-connect-my-Arlo-or-Arlo-Pro-base-station-to-the-Internet",
#                  "led": "https://kb.arlo.com/1179139/How-do-I-connect-my-Arlo-or-Arlo-Pro-base-station-to-the-Internet",
#                  "learnMore": "https://kb.arlo.com/000062124/How-do-I-record-4K-videos-to-a-microSD-card"
#                }
#              },
#              "arlobaby": {
#                "modelIds": [
#                  "ABC1000"
#                ],
#                "kbArticles": {
#                  "power": "https://kb.arlo.com/1282682/How-do-I-power-cycle-my-Arlo-Baby-camera",
#                  "qrCode": "https://kb.arlo.com/1282700/How-do-I-set-up-my-Arlo-Baby-camera"
#                }
#              },
#              "lteCamera":{
#                "modelIds":[
#                  "VML4030"
#                ],
#                "kbArticles":{
#                  "servicePlan":"https://kb.arlo.com/1286865/What-Arlo-Mobile-service-plans-are-available",
#                  "simActivation":"https://kb.arlo.com/1286865/What-Arlo-Mobile-service-plans-are-available",
#                  "qrCode":"https://kb.arlo.com/1201822/How-do-I-set-up-my-Arlo-Go-camera"
#                }
#              },
#              "bridge": {
#                "modelIds": [
#                  "ABB1000"
#                ],
#                "kbArticles": {
#                  "power": "https://kb.arlo.com/000062047",
#                  "sync": "https://kb.arlo.com/000062037",
#                  "qrCode": "https://kb.arlo.com/000061886",
#                  "factoryReset": "https://kb.arlo.com/000061837"
#                }
#              },
#              "lights": {
#                "modelIds": [
#                  "AL1101"
#                ],
#                "kbArticles": {
#                  "sync": "https://kb.arlo.com/000062005",
#                  "insertBatteries": "https://kb.arlo.com/000061952",
#                  "qrCode": "https://kb.arlo.com/000061886"
#                }
#              },
#              "routerM1":{
#                "modelIds":[
#                  "MR1100"
#                ],
#                "kbArticles":{
#                  "lookupFailed":"https://kb.arlo.com/1179130/Arlo-can-t-discover-my-base-station-during-installation-what-do-I-do"
#                }
#              },
#              "chime": {
#                "modelIds": [
#                  "AC1001"
#                ],
#                "kbArticles": {
#                  "ledNotBlinking":"https://kb.arlo.com/000061924",
#                  "led":"https://kb.arlo.com/000061847",
#                  "factoryReset":"https://kb.arlo.com/000061879",
#                  "connectionFailed":"https://kb.arlo.com/000061880"
#                }
#              },
#              "doorbell": {
#                "modelIds": [
#                  "AAD1001"
#                ],
#                "kbArticles": {
#                  "led":"https://kb.arlo.com/000061847",
#                  "factoryReset":"https://kb.arlo.com/000061842",
#                  "pairCamera":"https://kb.arlo.com/000061897",
#                  "existingChime":"https://kb.arlo.com/000061856",
#                  "noWiring":"https://kb.arlo.com/000061859",
#                  "connectionFailed":"https://kb.arlo.com/000061868",
#                  "pairCameraFailed":"https://kb.arlo.com/000061893",
#                  "testChimeFailed":"https://kb.arlo.com/000061944"
#                },
#                "videos": {
#                  "chimeType": "https://youtu.be/axytuF63VC0",
#                  "wireDoorbell": "https://youtu.be/_5D2n3iPqW0",
#                  "switchSetting": "https://youtu.be/BUmd4fik2RE"
#                },
#                "arloVideos": {
#                  "chimeType": "https://vzs3-prod-common.s3.amazonaws.com/static/devicesupport/Arlo_Audio_Doorbell_Chime.mp4",
#                  "wireDoorbell": "https://vzs3-prod-common.s3.amazonaws.com/static/devicesupport/Arlo_Audio_Doorbell_Wired.mp4",
#                  "switchSetting": "https://vzs3-prod-common.s3.amazonaws.com/static/devicesupport/Arlo_Audio_Doorbell_Switch.mp4"
#                }
#              }
#          },
#          "arlosmart": {
#              "kbArticles": {
#                "e911": "https://www.arlo.com/en-us/landing/arlosmart/",
#                "callFriend": "https://www.arlo.com/en-us/landing/arlosmart/",
#                "4kAddOnPopup": "https://www.arlo.com/en-us/landing/arlosmart/",
#                "cloudRecording": "https://www.arlo.com/en-us/landing/arlosmart/",
#                "manageArloSmart": "https://kb.arlo.com/000062115",
#                "otherVideo": "https://kb.arlo.com/000062115",
#                "packageDetection": "https://kb.arlo.com/000062114",
#                "whereIsBasicSubscriptionGone": "https://kb.arlo.com/000062163"
#              }
#            }
#          },
#          "success":true
#        }
#        """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/devicesupport/v3')
#
#    def GetDeviceCapabilities(self, device):
#        model = device.get('modelId').lower()
#        return self.request.get(f'https://{self.BASE_URL}/resources/capabilities/'+model+'/'+model+'_'+device.get('interfaceVersion')+'.json', raw=True)
#
#    def GetLibraryMetaData(self, from_date, to_date):
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/library/metadata', {'dateFrom':from_date, 'dateTo':to_date})
#
#    def UpdateProfile(self, first_name, last_name):
#        return self.request.put(f'https://{self.BASE_URL}/hmsweb/users/profile', {'firstName': first_name, 'lastName': last_name})
#
#    def UpdatePassword(self, password):
#        r = self.request.post(f'https://{self.BASE_URL}/hmsweb/users/changePassword', {'currentPassword':self.password,'newPassword':password})
#        self.password = password
#        return r
#
#    def UpdateFriend(self, body):
#        """
#        This is an example of the json you would pass in the body:
#        {
#          "firstName":"Some",
#          "lastName":"Body",
#          "devices":{
#            "XXXXXXXXXXXXX":"Camera 1",
#            "XXXXXXXXXXXXX":"Camera 2 ",
#            "XXXXXXXXXXXXX":"Camera 3"
#          },
#          "lastModified":1463977440911,
#          "adminUser":true,
#          "email":"user@example.com",
#          "id":"XXX-XXXXXXX"
#        }
#        """
#        return self.request.put(f'https://{self.BASE_URL}/hmsweb/users/friends', body)
#
#    def RemoveFriend(self, email):
#        """
#        Removes a person you've granted access to.
#
#        email: email of user you want to revoke access from.
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/friends/remove', {"email":email})
#
#    def AddFriend(self, firstname, lastname, email, devices={}, admin=False):
#        """
#        This API will send an email to a user and if they accept, will give them access to the devices you specify.
#        NOTE: XXX-XXXXXXX_XXXXXXXXXXXX is the uniqueId field in your device object.
#
#        {adminUser:false,firstName:John,lastName:Doe,email:john.doe@example.com,devices:{XXX-XXXXXXX_XXXXXXXXXXXX:Camera1,XXX-XXXXXXX_XXXXXXXXXXXX:Camera2}}
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/friends', {"adminUser":admin,"firstName":firstname,"lastName":lastname,"email":email,"devices":devices})
#
#    def ResendFriendInvite(self, friend):
#        """
#        This API will resend an invitation email to a user that you've AddFriend'd. You will need to get the friend object by calling GetFriend() because it includes a token that must be passed to this API.
#        friend: {"ownerId":"XXX-XXXXXXX","token":"really long string that you get from the GetFriends() API","firstName":"John","lastName":"Doe","devices":{"XXX-XXXXXXX_XXXXXXXXXXXX":"Camera1","XXX-XXXXXXX_XXXXXXXXXXXX":"Camera2"},"lastModified":1548470485419,"adminUser":false,"email":"john.doe@example.com"}
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/friends', friend)
#
#    def UpdateDeviceName(self, device, name):
#        return self.request.put(f'https://{self.BASE_URL}/hmsweb/users/devices/renameDevice', {'deviceId':device.get('deviceId'), 'deviceName':name, 'parentId':device.get('parentId')})
#
#    def UpdateDisplayOrder(self, body):
#        """
#        This is an example of the json you would pass in the body to UpdateDisplayOrder() of your devices in the UI.
#
#        XXXXXXXXXXXXX is the device id of each camera. You can get this from GetDevices().
#        {
#          "devices":{
#            "XXXXXXXXXXXXX":1,
#            "XXXXXXXXXXXXX":2,
#            "XXXXXXXXXXXXX":3
#          }
#        }
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/displayOrder', body)
#
#    def GetLibrary(self, from_date, to_date):
#        """
#        This call returns the following:
#        presignedContentUrl is a link to the actual video in Amazon AWS.
#        presignedThumbnailUrl is a link to the thumbnail .jpg of the actual video in Amazon AWS.
#
#        [
#          {
#            "mediaDurationSecond": 30,
#            "contentType": "video/mp4",
#            "name": "XXXXXXXXXXXXX",
#            "presignedContentUrl": "https://arlos3-prod-z2.s3.amazonaws.com/XXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXXX/XXX-XXXXXXX/XXXXXXXXXXXXX/recordings/XXXXXXXXXXXXX.mp4?AWSAccessKeyId=XXXXXXXXXXXXXXXXXXXX&Expires=1472968703&Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
#            "lastModified": 1472881430181,
#            "localCreatedDate": XXXXXXXXXXXXX,
#            "presignedThumbnailUrl": "https://arlos3-prod-z2.s3.amazonaws.com/XXXXXXX_XXXX_XXXX_XXXX_XXXXXXXXXXXXX/XXX-XXXXXXX/XXXXXXXXXXXXX/recordings/XXXXXXXXXXXXX_thumb.jpg?AWSAccessKeyId=XXXXXXXXXXXXXXXXXXXX&Expires=1472968703&Signature=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
#            "reason": "motionRecord",
#            "deviceId": "XXXXXXXXXXXXX",
#            "createdBy": "XXXXXXXXXXXXX",
#            "createdDate": "20160903",
#            "timeZone": "America/Chicago",
#            "ownerId": "XXX-XXXXXXX",
#            "utcCreatedDate": XXXXXXXXXXXXX,
#            "currentState": "new",
#            "mediaDuration": "00:00:30"
#          }
#        ]
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/library', {'dateFrom':from_date, 'dateTo':to_date})
#
#    def DeleteRecording(self, recording):
#        """
#        Delete a single video recording from Arlo.
#        All of the date info and device id you need to pass into this method are given in the results of the GetLibrary() call.
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/library/recycle', {'data':[{'createdDate':recording.get('createdDate'),'utcCreatedDate':recording.get('createdDate'),'deviceId':recording.get('deviceId')}]})
#
#    def BatchDeleteRecordings(self, recordings):
#        """
#        Delete a batch of video recordings from Arlo.
#
#        The GetLibrary() call response json can be passed directly to this method if you'd like to delete the same list of videos you queried for.
#        If you want to delete some other batch of videos, then you need to send an array of objects representing each video you want to delete.
#
#        [
#          {
#            "createdDate":"20160904",
#            "utcCreatedDate":1473010280395,
#            "deviceId":"XXXXXXXXXXXXX"
#          },
#          {
#            "createdDate":"20160904",
#            "utcCreatedDate":1473010280395,
#            "deviceId":"XXXXXXXXXXXXX"
#          }
#        ]
#        """
#        if recordings:
#            return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/library/recycle', {'data':recordings})
#
#    def GetRecording(self, url, chunk_size=4096):
#        """ Returns the whole video from the presignedContentUrl. """
#        video = ''
#        r = requests.get(url, stream=True)
#        r.raise_for_status()
#
#        for chunk in r.iter_content(chunk_size):
#            if chunk: video += chunk
#        return video
#
#    def StreamRecording(self, url, chunk_size=4096):
#        """
#        Returns a generator that is the chunked video stream from the presignedContentUrl.
#
#        url: presignedContentUrl
#        """
#        r = requests.get(url, stream=True)
#        r.raise_for_status()
#        for chunk in r.iter_content(chunk_size):
#            yield chunk
#
#    def DownloadRecording(self, url, to):
#        """
#        Writes a video to a given local file path.
#
#        url: presignedContentUrl
#        to: path where the file should be written
#        """
#        stream = self.StreamRecording(url)
#        with open(to, 'wb') as fd:
#            for chunk in stream:
#                fd.write(chunk)
#        fd.close()
#
#    def DownloadSnapshot(self, url, to, chunk_size=4096):
#        """
#        Writes a snapshot to a given local file path.
#
#        url: presignedContentUrl or presignedFullFrameSnapshotUrl
#        to: path where the file should be written
#        """
#        r = Request().get(url, stream=True)
#        with open(to, 'wb') as fd:
#            for chunk in r.iter_content(chunk_size):
#                fd.write(chunk)
#        fd.close()

    async def StartStream(self, basestation, camera):
        """
        This function returns the url of the rtsp video stream.
        This stream needs to be called within 30 seconds or else it becomes invalid.
        It can be streamed with: ffmpeg -re -i 'rtsps://<url>' -acodec copy -vcodec copy test.mp4
        The request to /users/devices/startStream returns: { url:rtsp://<url>:443/vzmodulelive?egressToken=b<xx>&userAgent=iOS&cameraId=<camid>}
        """
        stream_url_dict = self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/startStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"startUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId":camera.get('xCloudId')})
        return stream_url_dict['url'].replace("rtsp://", "rtsps://")

        resource = f"cameras/{camera.get('deviceId')}"

        # nonlocal variable hack for Python 2.x.
        class nl:
            stream_url_dict = None

        def trigger(self):
            nl.stream_url_dict = self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/startStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"startUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId":camera.get('xCloudId')})
            logger.debug(f"startStream returned {nl.stream_url_dict}")

        def callback(self, event):
            properties = event.get("properties", {})
            if properties.get("streamURL"):
                nl.stream_url_dict['url'] = properties["streamURL"]
            if properties.get("activityState") == "userStreamActive" or properties.get("activityState") == "startUserStream":
                return nl.stream_url_dict['url'].replace("rtsp://", "rtsps://")
            return None

        return await self.TriggerAndHandleEvent(basestation, resource, ["is"], trigger, callback)

    def StopStream(self, basestation, camera):
        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/stopStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.         get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"stopUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId": camera.get('xCloudId')})

        # nonlocal variable hack for Python 2.x.
        class nl:
            stream_url_dict = None

        def trigger(self):
            self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/stopStream', {"to":camera.get('parentId'),"from":self.user_id+"_web","resource":"cameras/"+camera.         get('deviceId'),"action":"set","responseUrl":"", "publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"stopUserStream","cameraId":camera.get('deviceId')}}, headers={"xcloudId": camera.get('xCloudId')})

        def callback(self, event):
            if event.get("from") == basestation.get("deviceId") and event.get("resource") == "cameras/"+camera.get("deviceId") and event.get("properties", {}).get("activityState") == "userStreamActive":
                return nl.stream_url_dict['url'].replace("rtsp://", "rtsps://")
            return None

        return self.TriggerAndHandleEvent(basestation, trigger, callback)

#    def TriggerStreamSnapshot(self, basestation, camera):
#        """
#        This function causes the camera to snapshot while recording.
#        NOTE: You MUST call StartStream() before calling this function.
#        If you call StartStream(), you have to start reading data from the stream, or streaming will be cancelled
#        and taking a snapshot may fail (since it requires the stream to be active).
#
#        NOTE: You should not use this function is you just want a snapshot and aren't intending to stream.
#        Use TriggerFullFrameSnapshot() instead.
#
#        NOTE: Use DownloadSnapshot() to download the actual image file.
#        """
#        def trigger(self):
#            self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/takeSnapshot', {'xcloudId':camera.get('xCloudId'),'parentId':camera.get('parentId'),'deviceId':camera.get('deviceId'),'olsonTimeZone':camera.get('properties', {}).get('olsonTimeZone')}, headers={"xcloudId":camera.get('xCloudId')})
#
#        def callback(self, event):
#            if event.get("deviceId") == camera.get("deviceId") and event.get("resource") == "mediaUploadNotification":
#                presigned_content_url = event.get("presignedContentUrl")
#                if presigned_content_url is not None:
#                    return presigned_content_url
#
#            return None
#
#        return self.TriggerAndHandleEvent(basestation, trigger, callback)

    async def TriggerFullFrameSnapshot(self, basestation, camera):
        """
        This function causes the camera to record a fullframe snapshot.
        The presignedFullFrameSnapshotUrl url is returned.
        Use DownloadSnapshot() to download the actual image file.
        """
        resource = f"cameras/{camera.get('deviceId')}"

        def trigger(self):
            self.request.post("https://my.arlo.com/hmsweb/users/devices/fullFrameSnapshot", {"to":camera.get("parentId"),"from":self.user_id+"_web","resource":"cameras/"+camera.get("deviceId"),"action":"set","publishResponse":True,"transId":self.genTransId(),"properties":{"activityState":"fullFrameSnapshot"}}, headers={"xcloudId":camera.get("xCloudId")})

        def callback(self, event):
            url = event.get("properties", {}).get("presignedFullFrameSnapshotUrl")
            if url:
                return url
            return None

        return await self.TriggerAndHandleEvent(basestation, resource, ["fullFrameSnapshotAvailable", "is"], trigger, callback)

#    def StartRecording(self, basestation, camera):
#        """
#        This function causes the camera to start recording.
#        You can get the timezone from GetDevices().
#        """
#        stream_url = self.StartStream(basestation, camera)
#        self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/startRecord', {'xcloudId':camera.get('xCloudId'),'parentId':camera.get('parentId'),'deviceId':camera.get('deviceId'),'olsonTimeZone':camera.get('properties', {}).get('olsonTimeZone')}, headers={"xcloudId":camera.get('xCloudId')})
#        return stream_url
#
#    def StopRecording(self, camera):
#        """
#        This function causes the camera to stop recording.
#        You can get the timezone from GetDevices().
#        """
#        return self.request.post(f'https://{self.BASE_URL}/hmsweb/users/devices/stopRecord', {'xcloudId':camera.get('xCloudId'),'parentId':camera.get('parentId'),'deviceId':camera.get('deviceId'),'olsonTimeZone':camera.get('properties', {}).get('olsonTimeZone')}, headers={"xcloudId":camera.get('xCloudId')})
#
#    def GetCvrPlaylist(self, camera, fromDate, toDate):
#        """ This function downloads a Cvr Playlist file for the period fromDate to toDate. """
#        return self.request.get(f'https://{self.BASE_URL}/hmsweb/users/devices/'+camera.get('deviceId')+'/playlist?fromDate='+fromDate+'&toDate='+toDate)
#