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

if [ -z "$SKIP_DOCKER_INSTALL" ]
then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    usermod -aG docker $SERVICE_USER
fi

WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum)
DOCKER_COMPOSE_YML=$SCRYPTED_HOME/docker-compose.yml
echo "Created $DOCKER_COMPOSE_YML"
curl -s https://raw.githubusercontent.com/koush/scrypted/main/docker/docker-compose.yml | sed s/SET_THIS_TO_SOME_RANDOM_TEXT/"$(echo $RANDOM | md5sum)"/g > $DOCKER_COMPOSE_YML

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
