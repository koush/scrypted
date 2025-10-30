if [ "$(uname -m)" = "x86_64" ]
then
    UBUNTU_22_04=$(lsb_release -r | grep "22.04")
    UBUNTU_24_04=$(lsb_release -r | grep "24.04")

    # needs either ubuntu 22.0.4 or 24.04
    if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
    then
        echo "NVIDIA graphics package can not be installed. Ubuntu version could not be detected when checking lsb-release and /etc/os-release."
        exit 1
    fi

    if [ -n "$UBUNTU_22_04" ]
    then
        distro="ubuntu2204"
    else
        distro="ubuntu2404"
    fi

    echo "Installing NVIDIA graphics packages."
    apt update -q \
        && apt install -y wget \
        && wget -qO /cuda-keyring.deb https://developer.download.nvidia.com/compute/cuda/repos/$distro/$(uname -m)/cuda-keyring_1.1-1_all.deb \
        && dpkg -i /cuda-keyring.deb \
        && apt update -q \
        && apt install -y cuda-nvcc-12-6 libcublas-12-6 libcudnn9-cuda-12 cuda-libraries-12-6;

    if [ "$?" != "0" ]
    then
        echo "Error: NVIDIA graphics packages failed to install."
        exit 1
    fi


    # Update: the libnvidia-opencl.so.1 file is not present in the container image, it is
    # mounted via the nvidia container runtime. This is why the following check is commented out.
    # this file is present but for some reason the icd file is not created by nvidia runtime.
    # if [ ! -f "/usr/lib/x86_64-linux-gnu/libnvidia-opencl.so.1" ]
    # then
    #     echo "Error: NVIDIA OpenCL library not found."
    #     exit 1
    # fi

    # the container runtime doesn't mount this file for some reason. seems to be a bug.
    # https://github.com/NVIDIA/nvidia-container-toolkit/issues/682
    # but the contents are simply the .so file, which is a symlink the nvidia runtime
    # will mount in.
    mkdir -p /etc/OpenCL/vendors/
    echo "libnvidia-opencl.so.1" > /etc/OpenCL/vendors/nvidia.icd
else
    echo "NVIDIA graphics will not be installed on this architecture."
fi

exit 0
