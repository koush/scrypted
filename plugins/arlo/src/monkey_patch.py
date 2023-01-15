# Keep PyAV's logging library intact
import av.logging
av.logging.restore_default_callback = lambda: None