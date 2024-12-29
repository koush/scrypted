#!/bin/bash
cd /root/.scrypted

# always immediately upgrade everything in case there's a broken update.
# this will also be preferable for troubleshooting via lxc reboot.
export DEBIAN_FRONTEND=noninteractive
yes | dpkg --configure -a
apt -y --fix-broken install && apt -y update && apt -y dist-upgrade

# force a pull to ensure we have the latest images.
# not using --pull always cause that fails everything on network down
docker compose pull

# do not daemonize, when it exits, systemd will restart it.
# force a recreate as .env may have changed.
# furthermore force recreate gets the container back into a known state
# which is preferable in case the user has made manual changes and then restarts.
WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum | head -c 32) docker compose up --force-recreate --abort-on-container-exit
