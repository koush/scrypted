#!/usr/bin/env bash

if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. Service will not be installed."
    exit 0
fi

if [ "$SERVICE_USER" == "root" ]
then
    echo "Scrypted SERVICE_USER root is not allowed."
    exit 1
fi

USER_HOME=$(eval echo ~$SERVICE_USER)
SCRYPTED_HOME=$USER_HOME/.scrypted
mkdir -p $SCRYPTED_HOME

set -e
cd $SCRYPTED_HOME

function readyn() {
    while true; do
        read -p "$1 (y/n) " yn
        case $yn in
            [Yy]* ) break;;
            [Nn]* ) break;;
            * ) echo "Please answer yes or no. (y/n)";;
        esac
    done
}

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
if [ -d /dev/dri ]
then
    sed -i 's/'#' - \/dev\/dri/- \/dev\/dri/g' $DOCKER_COMPOSE_YML
fi

echo "Setting permissions on $SCRYPTED_HOME"
chown -R $SERVICE_USER $SCRYPTED_HOME

echo "Optional:"
readyn "Edit docker-compose.yml to add external storage for Scrypted NVR?"

if [ "$yn" == "y" ]
then
    apt install nano
    nano $DOCKER_COMPOSE_YML
fi

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
