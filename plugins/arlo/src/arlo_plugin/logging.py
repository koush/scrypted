import logging
import sys

DEFAULT_LOG_LEVEL = logging.DEBUG

# custom log handler that sets the level and sends to stdout
def getLogger(name):
    logger = logging.getLogger(name)
    logger.setLevel(DEFAULT_LOG_LEVEL)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(DEFAULT_LOG_LEVEL)

    formatter = logging.Formatter('[%(asctime)s - %(levelname)s - %(name)s] %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger