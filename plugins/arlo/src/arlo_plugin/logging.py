import logging


class ScryptedDeviceLoggingWrapper(logging.Handler):
    scrypted_device = None

    def __init__(self, scrypted_device):
        super().__init__()
        self.scrypted_device = scrypted_device

    def emit(self, record):
        self.scrypted_device.print(self.format(record))


def createScryptedLogger(scrypted_device, name):
    logger = logging.getLogger(name)
    if logger.hasHandlers():
        return logger

    logger.setLevel(logging.INFO)

    # configure logger to output to scrypted's log stream
    sh = ScryptedDeviceLoggingWrapper(scrypted_device)

    # log formatting
    fmt = logging.Formatter("[Arlo %(name)s]: %(message)s")
    sh.setFormatter(fmt)

    # configure handler to logger
    logger.addHandler(sh)

    return logger


class ScryptedDeviceLoggerMixin:
    _logger = None
    logger_name = None

    @property
    def logger(self):
        if self._logger is None:
            self._logger = createScryptedLogger(self, self.logger_name)
        return self._logger