import os

EXPERIMENTAL = os.environ.get("SCRYPTED_ARLO_EXPERIMENTAL", "0") not in ["", "0"]