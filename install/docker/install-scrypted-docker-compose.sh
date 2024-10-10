#!/usr/bin/env bash

if [ "$SCRYPTED_LXC" ]
then
    export SERVICE_USER="root"
    export SCRYPTED_NONINTERACTIVE="true"
fi

if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. Service will not be installed."
    exit 0
fi

function readyn() {
    if [ ! -z "$SCRYPTED_NONINTERACTIVE" ]
    then
        yn="y"
        return
    fi

    while true; do
        read -p "$1 (y/n) " yn
        case $yn in
            [Yy]* ) break;;
            [Nn]* ) break;;
            * ) echo "Please answer yes or no. (y/n)";;
        esac
    done
}

if [ "$SERVICE_USER" == "root" ]
then
    readyn "Scrypted will store its files in the root user home directory. Running as a non-root user is recommended. Are you sure?"
    if [ "$yn" == "n" ]
    then
        exit 1
    fi
fi

echo "Stopping local service if it is running..."
systemctl stop scrypted.service 2> /dev/null
systemctl disable scrypted.service 2> /dev/null

USER_HOME=$(eval echo ~$SERVICE_USER)
SCRYPTED_HOME=$USER_HOME/.scrypted
mkdir -p $SCRYPTED_HOME
# remove various things from a previous local install.
rm -rf $SCRYPTED_HOME/node_modules
rm -rf $SCRYPTED_HOME/install.json
rm -rf $SCRYPTED_HOME/package.json
rm -rf $SCRYPTED_HOME/package-lock.json

set -e
cd $SCRYPTED_HOME

readyn "Install Docker?"

if [ "$yn" == "y" ]
then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $SERVICE_USER
fi

WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum | head -c 32)
echo "WATCHTOWER_HTTP_API_TOKEN=$WATCHTOWER_HTTP_API_TOKEN" > $SCRYPTED_HOME/.env
# remove the following line from .env to disable autoupdates.
# this is not recommended.
echo "WATCHTOWER_HTTP_API_PERIODIC_POLLS=true" >> $SCRYPTED_HOME/.env

DOCKER_COMPOSE_YML=$SCRYPTED_HOME/docker-compose.yml
curl -s https://raw.githubusercontent.com/koush/scrypted/main/install/docker/docker-compose.yml > $DOCKER_COMPOSE_YML
echo "Created $DOCKER_COMPOSE_YML"

if [ -z "$SCRYPTED_LXC" ]
then
    if [ -d /dev/dri ]
    then
        sed -i 's/'#' "\/dev\/dri/"\/dev\/dri/g' $DOCKER_COMPOSE_YML
    fi
else
    # uncomment lxc specific stuff
    sed -i 's/'#' lxc //g' $DOCKER_COMPOSE_YML
    # never restart, systemd will handle it
    sed -i 's/restart: unless-stopped/restart: no/g' $DOCKER_COMPOSE_YML

    sudo systemctl stop apparmor || true
    sudo apt -y purge apparmor || true
fi

readyn "Install avahi-daemon? This is the recommended for reliable HomeKit discovery and pairing."
if [ "$yn" == "y" ]
then
    sudo apt-get -y install avahi-daemon
    sed -i 's/'#' - \/var\/run\/dbus/- \/var\/run\/dbus/g' $DOCKER_COMPOSE_YML
    sed -i 's/'#' - \/var\/run\/avahi-daemon/- \/var\/run\/avahi-daemon/g' $DOCKER_COMPOSE_YML
    sed -i 's/'#' security_opt:/security_opt:/g' $DOCKER_COMPOSE_YML
    sed -i 's/'#'     - apparmor:unconfined/    - apparmor:unconfined/g' $DOCKER_COMPOSE_YML
fi

echo "Setting permissions on $SCRYPTED_HOME"
chown -R $SERVICE_USER $SCRYPTED_HOME || true

set +e

echo "docker compose down"
sudo -u $SERVICE_USER docker compose down 2> /dev/null
echo "docker compose rm -rf"
sudo -u $SERVICE_USER docker rm -f /scrypted /scrypted-watchtower 2> /dev/null

set -e

echo "docker compose pull"
sudo -u $SERVICE_USER docker compose pull

if [ -z "$SCRYPTED_LXC" ]
then
    echo "docker compose up -d"
    sudo -u $SERVICE_USER docker compose up -d
else
    export DOCKER_COMPOSE_SH=$SCRYPTED_HOME/docker-compose.sh

    curl https://raw.githubusercontent.com/koush/scrypted/main/install/proxmox/docker-compose.sh > $DOCKER_COMPOSE_SH

    chmod +x $DOCKER_COMPOSE_SH

    cat > /etc/systemd/system/scrypted.service <<EOT
[Unit]
Description=Scrypted service
After=network.target

[Service]
User=root
Group=root
Type=simple
ExecStart=$DOCKER_COMPOSE_SH
Restart=always
RestartSec=3
StandardOutput=null
StandardError=null

[Install]
WantedBy=multi-user.target
EOT

    systemctl daemon-reload
    systemctl enable scrypted.service
    systemctl restart scrypted.service
fi

echo
echo
echo
echo
echo "Scrypted is now running at: https://localhost:10443/"
echo "Note that it is https and that you'll be asked to approve/ignore the website certificate."
echo
echo
echo "Optional:"
echo "Scrypted NVR Recording storage directory can be configured with an additional script located at:"
echo "https://docs.scrypted.app/scrypted-nvr/recording-storage.html#docker-volume"
