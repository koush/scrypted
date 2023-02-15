import scrypted_sdk
from scrypted_sdk import RequestPictureOptions, MediaObject, Setting
import os
import json

class UnknownPeople(scrypted_sdk.ScryptedDeviceBase, scrypted_sdk.Settings, scrypted_sdk.Camera):
    def __init__(self, nativeId: str | None = None):
        super().__init__(nativeId)

    async def takePicture(self, options: RequestPictureOptions = None) -> MediaObject:
        volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
        people = os.path.join(volume, 'unknown')
        os.makedirs(people, exist_ok=True)
        for unknown in os.listdir(people):
            fp = os.path.join(people, unknown)
            ret = scrypted_sdk.mediaManager.createMediaObjectFromUrl('file:/' + fp)
            return await ret

        black = os.path.join(volume, 'zip', 'unzipped', 'fs', 'black.jpg')
        ret = scrypted_sdk.mediaManager.createMediaObjectFromUrl('file:/' + black)
        return await ret

    async def getSettings(self) -> list[Setting]:
        volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
        people = os.path.join(volume, 'unknown')
        os.makedirs(people, exist_ok=True)

        known = {}

        try:
            known = json.loads(self.storage.getItem('known'))
        except:
            pass

        choices = list(known.keys())

        ret: list[Setting] = [
            {
                'key': 'known',
                'title': 'Familiar People',
                'description': 'The people known this this plugin.',
                'choices': choices,
            }
        ]

        for unknown in os.listdir(people):
            ret.append(
                {
                    'key': unknown,
                    'title': 'Name',
                    'description': 'Associate this thumbnail with an existing person or identify a new person.',
                    'choices': choices,
                    'combobox': True,
                }
            )
            ret.append(
                {
                    'key': 'delete',
                    'title': 'Delete',
                    'description': 'Delete this face.',
                    'type': 'button',
                }
            )
            return ret

        ret.append(
            {
                'key': 'unknown',
                'title': 'Unknown People',
                'value': 'Waiting for unknown person...',
                'description': 'There are no more people that need to be identified.',
                'readonly': True,
            }
        )

        return ret

    async def putSetting(self, key: str, value: str) -> None:
        if key == 'known':
            return

        known = {}
        try:
            known = json.loads(self.storage.getItem('known'))
        except:
            pass
        choices = list(known.keys())

        if value or key == 'delete':
            volume = os.environ['SCRYPTED_PLUGIN_VOLUME']
            people = os.path.join(volume, 'unknown')
            os.makedirs(people, exist_ok=True)
            for unknown in os.listdir(people):
                fp = os.path.join(people, unknown)
                os.remove(fp)
                if value not in choices:
                    choices.append(value)

                break

        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Settings.value, None)
        await self.onDeviceEvent(scrypted_sdk.ScryptedInterface.Camera.value, None)