#!/bin/bash
cd /root/.scrypted

# always immediately upgrade everything in case there's a broken update.
# this will also be preferable for troubleshooting via lxc reboot.
export DEBIAN_FRONTEND=noninteractive
(apt -y --fix-broken install && dpkg --configure -a && apt -y update && apt -y dist-upgrade) &

# foreground pull if requested.
if [ -e "volume/.pull" ]
then
  rm -rf volume/.pull
  docker compose pull
else
  # always background pull in case there's a broken image.
  docker compose pull &
fi

# do not daemonize, when it exits, systemd will restart it.
docker compose up
