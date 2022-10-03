#!/usr/bin/env bash

if [ "$USER" != "root" ]
then
    echo "Installation must be run as 'root' (use sudo)."
    exit 1
fi

echo "Stopping existing service if it is running..."
systemctl stop scrypted.service

# bad hack to run a dockerfile like a shell script.

RUN() {
    # echo "Running: $@"
    $@
    if [ $? -ne 0 ]
    then
        echo 'Error during previous command.'
        exit 1
    fi
}

# The Dockefile.common contains an S6 overlay that should not be installed.
# Do not run anything until the ENTRYPOINT directive is sent.
ENTRYPOINT() {
    ALLOW_RUN=1
}

COPY() {
    echo "ignoring COPY $1"
}

FROM() {
    echo "ignoring FROM $1"
}

# process ARG for script variables but ignore ENV
ARG() {
    export $@
}

ENV() {
    echo "ignoring ENV $1"
}

source <(curl -s https://raw.githubusercontent.com/koush/scrypted/main/docker/template/Dockerfile.common.header)

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

# this is not RUN as we do not care about the result
USER_HOME=$(eval echo ~$SERVICE_USER)
echo "Setting permissions on $USER_HOME/.scrypted"
chown -R $SERVICE_USER $USER_HOME/.scrypted

echo "Installing Scrypted..."
RUN sudo -u $SERVICE_USER npx -y scrypted@latest install-server

cat > /etc/systemd/system/scrypted.service <<EOT

[Unit]
Description=Scrypted service
After=network.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
Type=simple
ExecStart=/usr/bin/npx -y scrypted serve
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target

EOT

RUN systemctl daemon-reload
RUN systemctl enable scrypted.service
RUN systemctl restart scrypted.service


set +x
echo
echo
echo
echo
echo "Scrypted Service has been installed (and started). You can start, stop, enable, or disable Scrypted with:"
echo "  systemctl start scrypted.service"
echo "  systemctl stop scrypted.service"
echo "  systemctl enable scrypted.service"
echo "  systemctl disable scrypted.service"
echo
echo "Scrypted is now running at: https://localhost:10443/"
echo "Note that it is https and that you'll be asked to approve/ignore the website certificate."
echo
echo
