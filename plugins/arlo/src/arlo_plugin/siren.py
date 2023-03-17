from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import OnOff, ScryptedInterface

from .device_base import ArloDeviceBase


class ArloSiren(ArloDeviceBase, OnOff):

    def get_applicable_interfaces(self) -> list:
        return [ScryptedInterface.OnOff.value]