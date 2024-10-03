#!/bin/bash

# disable core dumps.
# this doesn't disable core dumps on the scrypted service itself, only stuff run by init.
ulimit -c 0

if [[ "${SCRYPTED_DOCKER_AVAHI}" != "true" ]]; then
  echo "SCRYPTED_DOCKER_AVAHI != true, won't manage dbus nor avahi-daemon" >/dev/stderr
  exit 0
fi

if grep -qE " ((/var)?/run/dbus|(/var)?/run/avahi-daemon(/socket)?) " /proc/mounts; then
  echo "dbus and/or avahi-daemon volumes are bind mounted, won't touch them" >/dev/stderr
  exit 0
fi

# make run folders
mkdir -p /var/run/dbus
mkdir -p /var/run/avahi-daemon

# delete existing pids if they exist
[ -e /var/run/dbus.pid ] && rm -f /var/run/dbus.pid
[ -e /var/run/dbus/pid ] && rm -f /var/run/dbus/pid 
[ -e /run/dbus/pid ] && rm -f /run/dbus/pid
[ -e /var/run/avahi-daemon/pid ] && rm -f /var/run/avahi-daemon/pid
[ -e /var/run/dbus/system_bus_socket ] && rm -f /var/run/dbus/system_bus_socket

# service permissions
chown messagebus:messagebus /var/run/dbus
chown avahi:avahi /var/run/avahi-daemon
dbus-uuidgen --ensure
sleep 1

# fix for synology dsm - see oznu/docker-homebridge #35
if [ ! -z "$DSM_HOSTNAME" ]; then
  sed -i "s/.*host-name.*/host-name=${DSM_HOSTNAME}/" /etc/avahi/avahi-daemon.conf
else
  sed -i "s/.*host-name.*/#host-name=/" /etc/avahi/avahi-daemon.conf
fi
