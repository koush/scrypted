import logging
import sys


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
    fmt = logging.Formatter("(arlo) %(levelname)s:%(name)s:%(asctime)s.%(msecs)03d %(message)s", "%H:%M:%S")
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

aiortc_loggers = [
    "aiortc",
    "aiortc.rtcdatachannel",
    "aiortc.rtcdtlstransport",
    "aiortc.rtcicetransport",
    "aiortc.rtcpeerconnection",
    "aiortc.rtcrtpreceiver",
    "aiortc.rtcrtpsender",
    "aiortc.rtcrtptransceiver",
    "aiortc.rtcsctptransport",
    "aiortc.codecs.h264",
    "aiortc.contrib.media",
    "aiortc.contrib.signaling",
]

def init_aiortc_logger(logger_name):
    # get logger instance used by aiortc
    logger = logging.getLogger(logger_name)
    logger.setLevel(logging.INFO)

    # output logger to stdout
    ch = logging.StreamHandler(sys.stdout)

    # log formatting
    fmt = logging.Formatter("(arlo) %(levelname)s:%(name)s:%(asctime)s.%(msecs)03d %(message)s", "%H:%M:%S")
    ch.setFormatter(fmt)

    # configure handler to logger
    logger.addHandler(ch)

    if logger_name == "aiortc.rtcrtpsender":
        # rtcrtpsender is extremely noisy for DEBUG, so filter out all
        # the packet and bitrate logs
        logger.addFilter(lambda record: 0 if ") > " in record.getMessage() or ") - receiver" in record.getMessage() else 1)

for log in aiortc_loggers:
    init_aiortc_logger(log)

def propagate_aiortc_logging_level(log_level):
    for log in aiortc_loggers:
        logging.getLogger(log).setLevel(log_level)