# Motion Detection Plugin for Scrypted

The OpenCV Motion Detection Plugin adds motion detection to any camera. This can also be used with cameras with built in motion detection.

## Setup

1. Enable the integration on a camera.
2. Choose the lowest resolution substream available. The plugin does not need to analyze a full resolution video for motion, and processing anything over 300x300 will use excessive CPU time.
3. Configure the motion area and threshold to change the sensitivity.
4. You test your setup in the camera's OpenCV Motion Detection settings, by enabling `Motion Detection Events` to see when motion is triggered.
