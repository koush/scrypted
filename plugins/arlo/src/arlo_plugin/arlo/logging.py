import logging
import sys

# construct logger instance to be used by package arlo
logger = logging.getLogger("lib")
logger.setLevel(logging.INFO)

# output logger to stdout
ch = logging.StreamHandler(sys.stdout)

# log formatting
fmt = logging.Formatter("(arlo) %(levelname)s:%(name)s:%(asctime)s.%(msecs)03d %(message)s", "%H:%M:%S")
ch.setFormatter(fmt)

# configure handler to logger
logger.addHandler(ch)