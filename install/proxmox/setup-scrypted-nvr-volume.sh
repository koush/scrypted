#!/bin/bash

NVR_STORAGE=$1

if [ -z "$NVR_STORAGE" ]; then
  echo "Error: Proxmox Directory Disk not provided. Usage:"
  echo ""
  echo "$0 <proxmox-directory-disk>"
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

# use subdirectory doesn't conflict with Proxmox storage of backups etc...
STORAGE="$STORAGE/mounts/scrypted-nvr"
mkdir -p $STORAGE
chmod 0777 $STORAGE

pct stop "$VMID"

sed -i '/mnt\/nvr/d' "$FILE"

echo "lxc.mount.entry: $STORAGE mnt/nvr/large/$NVR_STORAGE none bind,optional,create=dir" >> "$FILE"

echo "$FILE modified successfully. Starting Scrypted..."
pct start $VMID
