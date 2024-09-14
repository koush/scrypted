#!/bin/bash

NVR_STORAGE=$1

# Check if NVR_STORAGE is set
if [ -z "$NVR_STORAGE" ]; then
  echo "Error: Proxmox Directory Disk not provided."
  echo ""
  echo "Usage:"
  echo ""
  echo "  $0 <proxmox-directory-disk>"
  exit 1
fi

# File to be modified
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

if [ ! -d "/mnt/pve/nvr-storage/mounts/$NVR_STORAGE" ]
then
  echo "Error: /mnt/pve/nvr-storage/mounts/$NVR_STORAGE not found."
  echo "The Proxmox Directory Storage must be created using the UI prior to running this script."
  exit 1
fi

# Remove all lines containing "mnt/nvr"
sed -i '/mnt\/nvr/d' "$FILE"

# Append the new line with the substituted $NVR_STORAGE
echo "lxc.mount.entry: /mnt/pve/nvr-storage/mounts/$NVR_STORAGE mnt/nvr/large/$NVR_STORAGE none bind,optional,create=dir // [!code focus]" >> "$FILE"

echo "$FILE modified successfully. Starting Scrypted..."
pct start $VMID
