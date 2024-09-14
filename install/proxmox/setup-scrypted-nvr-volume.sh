#!/bin/bash

NVR_STORAGE=$1

DISK_TYPE="large"
if [ ! -z "$FAST_DISK" ]
then
    DISK_TYPE="fast"
fi

if [ -z "$NVR_STORAGE" ]; then
  echo ""
  echo "Error: Proxmox Directory Disk not provided. Usage:"
  echo ""
  echo "bash $0 <proxmox-directory-disk>"
  echo ""
  exit 1
fi

if [ -z "$VMID" ]
then
    VMID="10443"
fi
FILE="/etc/pve/lxc/$VMID.conf"

# valdiate file exists
if [ ! -f "$FILE" ]; then
  echo "Error: $FILE not found."
  echo "If the Scrypted container id is not 10443, please set the VMID environment variable prior to running this script."
  exit 1
fi

STORAGE="/mnt/pve/$NVR_STORAGE"

if [ ! -d "$STORAGE" ]
then
  echo "Error: $STORAGE not found."
  echo "The Proxmox Directory Storage must be created using the UI prior to running this script."
  exit 1
fi

# use subdirectory doesn't conflict with Proxmox storage of backups etc.
STORAGE="$STORAGE/mounts/scrypted-nvr"
# create the hidden folder that can be used as a marker.
mkdir -p $STORAGE/.nvr
chmod 0777 $STORAGE

echo "Stopping Scrypted..."
pct stop "$VMID"

echo "Modifying $FILE."

if [ -z "$ADD_DISK" ]
then
  echo "Removing previous $DISK_TYPE lxc.mount.entry."
  sed -i "/mnt\/nvr\/$DISK_TYPE/d" "$FILE"
fi

echo "Adding new $DISK_TYPE lxc.mount.entry."
echo "lxc.mount.entry: $STORAGE mnt/nvr/$DISK_TYPE/$NVR_STORAGE none bind,optional,create=dir" >> "$FILE"

echo "Starting Scrypted..."
pct start $VMID
