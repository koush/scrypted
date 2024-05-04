if [ "$(uname -m)" = "x86_64" ]
then
    echo "Installing NVIDIA graphics packages."
    apt update -q \
        && apt install wget \
        && wget -qO /cuda-keyring.deb https://developer.download.nvidia.com/compute/cuda/repos/ubuntu2204/x86_64/cuda-keyring_1.1-1_all.deb \
        && dpkg -i /cuda-keyring.deb \
        && apt update -q \
        && apt install -y cuda-nvcc-11-8 libcublas-11-8 libcudnn8 cuda-libraries-11-8 \
        && apt install -y cuda-nvcc-12-4 libcublas-12-4 libcudnn8 cuda-libraries-12-4;
    exit $?
else
    echo "NVIDIA graphics will not be installed on this architecture."
fi

exit 0
