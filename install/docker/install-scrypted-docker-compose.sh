#!/usr/bin/env bash

if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. Service will not be installed."
    exit 0
fi

function readyn() {
    if [ "$SCRYPTED_NONINTERACTIVE" == "1" ]
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

set -e
cd $SCRYPTED_HOME

readyn "Install Docker?"

if [ "$yn" == "y" ]
then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $SERVICE_USER
fi

WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum)
DOCKER_COMPOSE_YML=$SCRYPTED_HOME/docker-compose.yml
echo "Created $DOCKER_COMPOSE_YML"
curl -s https://raw.githubusercontent.com/koush/scrypted/main/install/docker/docker-compose.yml | sed s/SET_THIS_TO_SOME_RANDOM_TEXT/"$(echo $RANDOM | md5sum | head -c 32)"/g > $DOCKER_COMPOSE_YML

if [ -z "$SCRYPTED_LXC" ]
then
    if [ -d /dev/dri ]
    then
        sed -i 's/'#' "\/dev\/dri/"\/dev\/dri/g' $DOCKER_COMPOSE_YML
    fi
else
    sed -i 's/'#' lxc //g' $DOCKER_COMPOSE_YML
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
chown -R $SERVICE_USER $SCRYPTED_HOME

set +e

echo "docker compose down"
sudo -u $SERVICE_USER docker compose down 2> /dev/null
echo "docker compose rm -rf"
sudo -u $SERVICE_USER docker rm -f /scrypted /scrypted-watchtower 2> /dev/null

set -e

echo "docker compose pull"
sudo -u $SERVICE_USER docker compose pull
echo "docker compose up -d"
sudo -u $SERVICE_USER docker compose up -d

echo
echo
echo
echo
echo "Scrypted is now running at: https://localhost:10443/"
echo "Note that it is https and that you'll be asked to approve/ignore the website certificate."
echo
echo
echo "Optional:"
echo "Scrypted NVR Recording storage directory can be configured with an additional script:"
echo "https://docs.scrypted.app/scrypted-nvr/installation.html#docker-volume"
