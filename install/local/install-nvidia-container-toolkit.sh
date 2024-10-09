UBUNTU_22_04=$(lsb_release -r | grep "22.04")
UBUNTU_24_04=$(lsb_release -r | grep "24.04")

set -e
# https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=Ubuntu&target_version=24.04&target_type=deb_network
# need this apt for nvidia-utils
# needs either ubuntu 22.0.4 or 24.04
if [ -z "$UBUNTU_22_04" ] && [ -z "$UBUNTU_24_04" ]
then
    echo "NVIDIA container toolkit can not be installed. Ubuntu version could not be detected when checking lsb-release and /etc/os-release."
    exit 1
fi

if [ -n "$UBUNTU_22_04" ]
then
    distro="ubuntu2204"
else
    distro="ubuntu2404"
fi

apt update -q \
    && apt install -y wget \
    && wget -qO /cuda-keyring.deb https://developer.download.nvidia.com/compute/cuda/repos/$distro/$(uname -m)/cuda-keyring_1.1-1_all.deb \
    && dpkg -i /cuda-keyring.deb;

# https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
apt -y update
apt -y install gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --yes --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
  && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt -y update
# is there a way to get a versioned package automatically?
apt -y install nvidia-utils-560
apt -y install nvidia-container-toolkit

nvidia-ctk runtime configure --runtime=docker
nvidia-ctk config --set nvidia-container-cli.no-cgroups --in-place
systemctl restart docker
