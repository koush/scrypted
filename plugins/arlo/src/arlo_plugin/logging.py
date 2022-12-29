import logging
from logging import Logger
from scrypted_sdk import ScryptedDeviceBase


class ScryptedDeviceLoggingWrapper(logging.Handler):
    scrypted_device: ScryptedDeviceBase = None

    def __init__(self, scrypted_device: ScryptedDeviceBase) -> None:
        super().__init__()
        self.scrypted_device = scrypted_device

    def emit(self, record) -> None:
        self.scrypted_device.print(self.format(record))


def createScryptedLogger(scrypted_device: ScryptedDeviceBase, name: str) -> Logger:
    logger = logging.getLogger(name)
    if logger.hasHandlers():
        return logger

    logger.setLevel(logging.INFO)

    # configure logger to output to scrypted's log stream 
    sh = ScryptedDeviceLoggingWrapper(scrypted_device)

    # log formatting
    fmt = logging.Formatter("(arlo) %(levelname)s:%(name)s:%(asctime)s.%(msecs)03d %(message)s", "%H:%M:%S")
    sh.setFormatter(fmt)

    # configure handler to logger
    logger.addHandler(sh)

    return logger


class ScryptedDeviceLoggerMixin:
    _logger: Logger = None
    logger_name: str = None

    @property
    def logger(self) -> Logger:
        if self._logger is None:
            self._logger = createScryptedLogger(self, self.logger_name)
        return self._logger