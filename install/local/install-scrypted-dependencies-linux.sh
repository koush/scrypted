#!/usr/bin/env bash

# Node 17 changes the dns resolution order to return the record order.
# This causes issues with clients that are on "IPv6" networks that are
# actually busted and fail to connect to npm's IPv6 address.
# The workaround is to favor IPv4.
export NODE_OPTIONS=--dns-result-order=ipv4first

if [ "$USER" != "root" ]
then
    echo "Installation must be run as 'root' (use sudo)."
    exit 1
fi

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

if [ "$SERVICE_USER" = "root" ] && [ -z "$SERVICE_USER_ROOT" ]
then
    readyn "Scrypted will store its files in the root user home directory. Running as a non-root user is recommended. Are you sure?"
    if [ "$yn" == "n" ]
    then
        exit 1
    fi
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

ENTRYPOINT() {
    echo "ignoring ENTRYPOINT $1"
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
    export $@
}

source <(curl -s https://raw.githubusercontent.com/koush/scrypted/main/install/docker/template/Dockerfile.full.header)
if [ -z "$SCRYPTED_INSTALL_ENVIRONMENT" ]
then
    SCRYPTED_INSTALL_ENVIRONMENT=local
fi
if [ "$SCRYPTED_INSTALL_ENVIRONMENT" = "lxc" ]
then
    source <(curl -s https://raw.githubusercontent.com/koush/scrypted/main/install/docker/template/Dockerfile.full.footer)
fi

if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. Service will not be installed."
    exit 0
fi

# this is not RUN as we do not care about the result
USER_HOME=$(eval echo ~$SERVICE_USER)
echo "Setting permissions on $USER_HOME/.scrypted"
chown -R $SERVICE_USER $USER_HOME/.scrypted

echo "Stopping docker service if it exists..."
cd $USER_HOME/.scrypted
echo "docker compose down"
sudo -u $SERVICE_USER docker compose down 2> /dev/null
echo "docker compose rm -rf"
sudo -u $SERVICE_USER docker rm -f /scrypted /scrypted-watchtower 2> /dev/null

echo "Installing Scrypted..."
RUN sudo -u $SERVICE_USER npx -y scrypted@latest install-server $SCRYPTED_INSTALL_VERSION

cat > /etc/systemd/system/scrypted.service <<EOT

[Unit]
Description=Scrypted service
After=network.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
Type=simple
ExecStart=/usr/bin/npx -y scrypted serve
Restart=always
RestartSec=3
Environment="NODE_OPTIONS=$NODE_OPTIONS"
Environment="SCRYPTED_INSTALL_ENVIRONMENT=$SCRYPTED_INSTALL_ENVIRONMENT"
StandardOutput=null
StandardError=null

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
