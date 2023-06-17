# TensorFlow Lite Object Detection for Scrypted

This plugin adds object detection capabilities to any camera in Scrypted. Having a fast GPU and CPU is highly recommended. Edge TPU (Coral.ai) is also supported.

The Tensorflow Lite Plugin should only be used if you are a Scrypted NVR user. It will provide no
benefits to HomeKit, which does its own detection processing.

## EdgeTPU Docker Instructions

To use a Coral EdgeTPU within docker, the docker host must install the EdgeTPU drivers:

* USB: https://coral.ai/docs/accelerator/get-started/
* M.2 or PCIe: https://coral.ai/docs/m2/get-started/

Then bring the container down and back up:

```sh
cd ~/.scrypted
docker compose down
docker compose up -d
```
