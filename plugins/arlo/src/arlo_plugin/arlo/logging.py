import logging
import sys

# construct logger instance to be used by package arlo
logger = logging.getLogger("lib")
logger.setLevel(logging.INFO)

# output logger to stdout
ch = logging.StreamHandler(sys.stdout)

# log formatting
fmt = logging.Formatter("[Arlo]: %(message)s")
ch.setFormatter(fmt)

# configure handler to logger
logger.addHandler(ch)