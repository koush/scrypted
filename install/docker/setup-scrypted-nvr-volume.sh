
if [ -z "$SERVICE_USER" ]
then
    echo "Scrypted SERVICE_USER environment variable was not specified. NVR Storage can not be configured."
    exit 0
fi

if [ "$USER" != "root" ]
then
    echo "$USER"
    echo "This script must be run as sudo or root."
    exit 1
fi

USER_HOME=$(eval echo ~$SERVICE_USER)
SCRYPTED_HOME=$USER_HOME/.scrypted
DOCKER_COMPOSE_YML=$SCRYPTED_HOME/docker-compose.yml

if [ ! -f "$DOCKER_COMPOSE_YML" ]
then
    echo "$DOCKER_COMPOSE_YML not found. Install Scrypted first."
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

if [ -z "$1" ]
then
    lsblk
    echo ""
    echo "Please run the script with an existing mount path or the 'disk' device to format (e.g. sdx)."
    exit 1
fi

BLOCK_DEVICE="/dev/$1"
if [ -b "$BLOCK_DEVICE" ]
then
    readyn "Format $BLOCK_DEVICE?"
    if [ "$yn" == "n" ]
    then
        exit 1
    fi

    umount "$BLOCK_DEVICE"1 2> /dev/null
    umount "$BLOCK_DEVICE"2 2> /dev/null
    umount /mnt/scrypted-nvr 2> /dev/null

    set -e
    parted "$BLOCK_DEVICE" --script mklabel gpt
    parted -a optimal "$BLOCK_DEVICE" mkpart scrypted-nvr "0%" "100%"
    set +e

    sync
    mkfs -F -t ext4 "$BLOCK_DEVICE"1
    sync

    for attr in $(blkid | grep "$BLOCK_DEVICE")
    do
        e=$(echo $attr | grep =)
        if [ ! -z "$e" ]
        then
            # echo "$e"
            export "$e"
        fi
    done
    if [ -z "$UUID" ]
    then
        echo "Error parsing disk UUID."
        exit 1
    fi

    echo "UUID: $UUID"
    set -e
    if [ ! -f "/etc/fstab.scrypted-bak" ]
    then
        cp /etc/fstab /etc/fstab.scrypted-bak
    fi
    grep -v "scrypted-nvr" /etc/fstab > /tmp/fstab && cp /tmp/fstab /etc/fstab
    # ensure newline
    sed -i -e '$a\' /etc/fstab
    mkdir -p /mnt/scrypted-nvr
    echo "PARTLABEL=scrypted-nvr     /mnt/scrypted-nvr    ext4   defaults 0 0" >> /etc/fstab
    mount -a
    set +e
else
    DIR=$1
fi
