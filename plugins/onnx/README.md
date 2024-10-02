# ONNX Object Detection for Scrypted

This plugin adds object detection capabilities to any camera in Scrypted. Having a fast GPU and CPU is highly recommended.

The ONNX Plugin should only be used if you are a Scrypted NVR user. It will provide no
benefits to HomeKit, which does its own detection processing.

# Windows Setup

Windows setup requires several installation steps and system PATH variables to be set correctly. The NVIDIA installers does not do this correctly if older CUDA or CUDNN exists.

1. Install latest NVIDIA drivers.
2. Install CUDA 12.x.
3. Install CUDNN 9.x.
4. Open a new Terminal.
5. Verify CUDA_PATH environment is set.
  * The syste, CUDA_PATH can be set in Windows Advanced System Settings.
6. Verify PATH contains the path to CUDNN\bin\12.x, where the `cudnn64_9.dll` file is located. Typically it will be somewhere like: `"C:\Program Files\NVIDIA\CUDNN\v9.4\bin\12.6\cudnn64_9.dll"`.
  * The system PATH can be set in Windows Advanced System Settings.
7. Exit Scrypted.
8. Reopen Scrypted.

# Linux Setup

1. Install NVIDIA drivers on host.
2. Install CUDA and CUDNN.
3. Follow the NVIDIA setup steps for the NVIDIA docker image. https://docs.scrypted.app/installation.html#linux-docker