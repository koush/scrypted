# Video Analysis Plugin for Scrypted

The Video Analysis plugin for Scrypted serves two purposes:

* Add motion and object detection capabilities to any camera using plugins like OpenCV, OpenVINO, or CoreML.
* Create smart motion sensors from a camera's object detection (people, animal, car, etc). These detections can come from an aforementioned Object Detection Plugin or the camera hardware itself.

Motion Detection should only be used if your camera does not have a plugin and does not provide motion
events via email or webhooks.

Object Detection Plugins should only be used if you are a Scrypted NVR user. It will provide no
benefits to HomeKit, which does its own detection processing.

## Smart Motion Sensors

This plugin can be used to create smart motion sensors that trigger when a specific type of object (vehicle, person, animal, etc) triggers movement on a camera. Created sensors can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This Sensor requires cameras with hardware or software object detection capability.

## Smart Occupancy Sensors

This plugin can be used to create smart occupancy sensors remains triggered when a specific type of object (vehicle, person, animal, etc) is detected on a camera. Created sensors can then be synced to other platforms such as HomeKit, Google Home, Alexa, or Home Assistant for use in automations. This Sensor requires an object detector plugin such as Scrypted NVR, OpenVINO, CoreML, ONNX, or Tensorflow-lite.