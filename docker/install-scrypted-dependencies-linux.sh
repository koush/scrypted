#!/usr/bin/env bash

set -x

# bad hack to run a dockerfile like a shell script.

RUN() {
    $@
    if [ "$?" != "0" ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

FROM() {
    echo 'Installing nodejs repo'
    RUN curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    RUN apt-get install -y nodejs
}

ARG() {
    echo "ignoring ARG $1"
}

ENV() {
    echo "ignoring ENV $1"
}

source <(curl -s https://raw.githubusercontent.com/koush/scrypted/main/docker/Dockerfile.common)

if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. Service will not be installed."
    exit 0
fi

cat <<EOT > /etc/systemd/system/scrypted.service

[Unit]
Description=Scrypted service
After=network.target

[Service]
User=pi
Group=pi
Type=simple
KillMode=process
ExecStart=/usr/bin/npx -y scrypted serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target

EOT

RUN systemctl enable scrypted.service
RUN systemctl restart scrypted.service
