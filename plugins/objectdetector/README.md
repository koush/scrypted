# Video Analysis Plugin for Scrypted

This plugin is used by motion and detection plugins such as OpenCV, PAM Diff, and Object Detection.

Motion Detection should only be used if your camera does not have a plugin and does not provide motion
events via email or webhooks.

The Object Detection Plugin should only be used if you are a Scrypted NVR user. It will provide no
benefits to HomeKit, which does its own detection processing.

## Smart Motion Sensors

This plugin can be used to create smart motion sensors that trigger when a specific type of object (car, person, dog, etc) triggers movement on a camera. Created sensors can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This feature requires cameras with hardware or software object detection capability.
