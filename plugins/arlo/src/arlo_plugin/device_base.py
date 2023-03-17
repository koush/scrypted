from scrypted_sdk import ScryptedDeviceBase

from .logging import ScryptedDeviceLoggerMixin
from .util import BackgroundTaskMixin
from .provider import ArloProvider

class ArloDeviceBase(ScryptedDeviceBase, ScryptedDeviceLoggerMixin, BackgroundTaskMixin):
    nativeId: str = None
    arlo_device: dict = None
    arlo_basestation: dict = None
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

    def __del__(self):
        self.stop_subscriptions = True
        self.cancel_pending_tasks()

    def get_applicable_interfaces(self) -> list:
        return []