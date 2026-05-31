#!/bin/bash

NVR_STORAGE=$1
NVR_STORAGE_DIRECTORY=$2

DISK_TYPE="large"
if [ ! -z "$FAST_DISK" ]
then
    DISK_TYPE="fast"
fi

if [ -z "$NVR_STORAGE" ]; then
  echo ""
  echo "Error: Directory name not provided. Usage:"
  echo ""
  echo "bash $0 directory-name [/optional/path/to/storage]"
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

if [ ! -z "$NVR_STORAGE_DIRECTORY" ]
then
  if [ ! -d "$NVR_STORAGE_DIRECTORY" ]
  then
    echo ""
    echo "Error: $NVR_STORAGE_DIRECTORY directory not found."
    echo ""
    exit 1
  fi
else
  STORAGE="/mnt/pve/$NVR_STORAGE"
  if [ ! -d "$STORAGE" ]
  then
    echo "Error: $STORAGE not found."
    echo "The Proxmox Directory Storage must be created using the UI prior to running this script."
    exit 1
  fi
  # use subdirectory doesn't conflict with Proxmox storage of backups etc.
  NVR_STORAGE_DIRECTORY="$STORAGE/mounts/scrypted-nvr"
fi

# create the hidden folder that can be used as a marker.
mkdir -p $NVR_STORAGE_DIRECTORY/.nvr
chmod 0777 $NVR_STORAGE_DIRECTORY

echo "Stopping Scrypted..."
pct stop "$VMID"

echo "Modifying $FILE."

if [ -z "$ADD_DISK" ]
then
  echo "Removing previous $DISK_TYPE lxc.mount.entry."
  sed -i "/mnt\/nvr\/$DISK_TYPE/d" "$FILE"
fi

echo "Adding new $DISK_TYPE lxc.mount.entry."
echo "lxc.mount.entry: $NVR_STORAGE_DIRECTORY mnt/nvr/$DISK_TYPE/$NVR_STORAGE none bind,optional,create=dir" >> "$FILE"

echo "Starting Scrypted..."
pct start $VMID
