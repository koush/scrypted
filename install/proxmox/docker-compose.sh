#!/bin/bash
cd /root/.scrypted

# always immediately upgrade everything in case there's a broken update.
# this will also be preferable for troubleshooting via lxc reboot.
export DEBIAN_FRONTEND=noninteractive

# auto updates may break the system?
# watchtower stopped working after a docker update, so disabling for now.
# yes | dpkg --configure -a
# apt -y --fix-broken install && apt -y update && apt -y dist-upgrade

function cleanup() {
    IS_UP=$(docker compose ps scrypted -a | grep Up)
    # Only clean up when scrypted is running to safely free space without risking its image deletion
    if [ -z "$IS_UP" ]; then
        echo "scrypted is not running, skipping cleanup to preserve its image"
        return
    fi
    echo $(date) > .last_cleanup
    echo "scrypted is running, proceeding with cleanup to free space"
    docker container prune -f
    docker image prune -a -f
}

# force a pull to ensure we have the latest images.
# not using --pull always cause that fails everything on network down
docker compose pull

(sleep 60 && cleanup) &

# do not daemonize, when it exits, systemd will restart it.
# force a recreate as .env may have changed.
# furthermore force recreate gets the container back into a known state
# which is preferable in case the user has made manual changes and then restarts.
WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum | head -c 32) docker compose up --force-recreate

# abort on container exit is problematic if watchtower is the one that aborts.
# WATCHTOWER_HTTP_API_TOKEN=$(echo $RANDOM | md5sum | head -c 32) docker compose up --force-recreate --abort-on-container-exit
