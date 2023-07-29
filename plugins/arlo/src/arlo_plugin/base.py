from __future__ import annotations

import traceback
from typing import List, TYPE_CHECKING

from scrypted_sdk import ScryptedDeviceBase
from scrypted_sdk.types import Device

from .logging import ScryptedDeviceLoggerMixin
from .util import BackgroundTaskMixin

if TYPE_CHECKING:
    # https://adamj.eu/tech/2021/05/13/python-type-hints-how-to-fix-circular-imports/
    from .provider import ArloProvider


class ArloDeviceBase(ScryptedDeviceBase, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
    nativeId: str = None
    arlo_device: dict = None
    arlo_basestation: dict = None
    arlo_capabilities: dict = None
    provider: ArloProvider = None
    stop_subscriptions: bool = False

    def __init__(self, nativeId: str, arlo_device: dict, arlo_basestation: dict, provider: ArloProvider) -> None:
        super().__init__(nativeId=nativeId)

        self.logger_name = nativeId

        self.nativeId = nativeId
        self.arlo_device = arlo_device
        self.arlo_basestation = arlo_basestation
        self.provider = provider
        self.logger.setLevel(self.provider.get_current_log_level())

        try:
            self.arlo_capabilities = self.provider.arlo.GetDeviceCapabilities(self.arlo_device)
        except Exception as e:
            self.logger.warning(f"Could not load device capabilities: {e}")
            self.arlo_capabilities = {}

    def __del__(self) -> None:
        self.stop_subscriptions = True
        self.cancel_pending_tasks()

    def get_applicable_interfaces(self) -> List[str]:
        """Returns the list of Scrypted interfaces that applies to this device."""
        return []

    def get_device_type(self) -> str:
        """Returns the Scrypted device type that applies to this device."""
        return ""

    def get_device_manifest(self) -> Device:
        """Returns the Scrypted device manifest representing this device."""
        parent = None
        if self.arlo_device.get("parentId") and self.arlo_device["parentId"] != self.arlo_device["deviceId"]:
            parent = self.arlo_device["parentId"]

        if parent in self.provider.hidden_device_ids:
            parent = None

        return {
            "info": {
                "model": f"{self.arlo_device['modelId']} {self.arlo_device['properties'].get('hwVersion', '')}".strip(),
                "manufacturer": "Arlo",
                "firmware": self.arlo_device.get("firmwareVersion"),
                "serialNumber": self.arlo_device["deviceId"],
            },
            "nativeId": self.arlo_device["deviceId"],
            "name": self.arlo_device["deviceName"],
            "interfaces": self.get_applicable_interfaces(),
            "type": self.get_device_type(),
            "providerNativeId": parent,
        }

    def get_builtin_child_device_manifests(self) -> List[Device]:
        """Returns the list of child device manifests representing hardware features built into this device."""
        return []