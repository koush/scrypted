# Rockchip NPU Object Detection for Scrypted

This plugin adds object detection capabilities to any camera in Scrypted using the NPU accelerator on ARM64 Rockchip CPUs. Functionality has been tested on RK3588S, but should also work on RK3562, RK3576, and RK3588.

Using this plugin in Docker requires Docker to be run with the `--privileged` flag. When using this plugin in a local install, ensure you have installed Rockchip's `librknnrt.so` as `/usr/lib/librknnrt.so`.