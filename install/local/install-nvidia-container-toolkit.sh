cd ~/.scrypted
docker compose down

set -e

# https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html
apt -y update
apt -y install gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg \
  && curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt -y update
# is there a way to get a versioned package automatically?
apt -y install nvidia-utils-560
apt -y install nvidia-container-toolkit

nvidia-ctk runtime configure --runtime=docker
nvidia-ctk config --set nvidia-container-cli.no-cgroups --in-place
systemctl restart docker
