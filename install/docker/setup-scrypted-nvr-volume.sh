
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

NVR_MOUNT_LINE=$(cat "$DOCKER_COMPOSE_YML" | grep :/nvr)
if [ -z "$NVR_MOUNT_LINE" ]
then
    echo "Unexpected contents in $DOCKER_COMPOSE_YML. Rerun the Scrypted docker compose installer."
    exit 1
fi

function backup() {
    BACKUP_FILE="$1".scrypted-bak
    if [ ! -f "$BACKUP_FILE" ]
    then
        cp "$1" "$BACKUP_FILE"
    fi
}

backup "$DOCKER_COMPOSE_YML"

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

function stopscrypted() {
    cd $SCRYPTED_HOME
    echo ""
    echo "Stopping the Scrypted container. If there are any errors during disk setup, Scrypted will need to be manually restarted with:"
    echo "cd $SCRYPTED_HOME && docker compose up -d"
    echo ""
    sudo -u $SERVICE_USER docker compose down 2> /dev/null
}

function removescryptedfstab() {
    backup "/etc/fstab"
    grep -v "scrypted-nvr" /etc/fstab > /tmp/fstab && cp /tmp/fstab /etc/fstab
    # ensure newline
    sed -i -e '$a\' /etc/fstab
    systemctl daemon-reload
}

BLOCK_DEVICE="/dev/$1"
if [ -b "$BLOCK_DEVICE" ]
then
    readyn "Format $BLOCK_DEVICE?"
    if [ "$yn" == "n" ]
    then
        exit 1
    fi

    stopscrypted

    umount "$BLOCK_DEVICE"1 2> /dev/null
    umount "$BLOCK_DEVICE"2 2> /dev/null
    umount /mnt/scrypted-nvr 2> /dev/null

    set -e
    parted "$BLOCK_DEVICE" --script mklabel gpt
    parted -a optimal "$BLOCK_DEVICE" mkpart scrypted-nvr "0%" "100%"
    set +e

    sync
    PARTITION_DEVICE="$BLOCK_DEVICE"1
    if [ ! -e "$PARTITION_DEVICE" ]
    then
        PARTITION_DEVICE="$BLOCK_DEVICE"p1
        if [ ! -e "$PARTITION_DEVICE" ]
        then
            echo "Unable to determine block device partition from block device: $BLOCK_DEVICE"
            exit 1
        fi
    fi
    mkfs -F -t ext4 "$PARTITION_DEVICE"
    sync

    # parse/evaluate blkid line as env vars
    for attr in $(blkid | grep "$BLOCK_DEVICE")
    do
        e=$(echo $attr | grep =)
        if [ ! -z "$e" ]
        then
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
    removescryptedfstab
    mkdir -p /mnt/scrypted-nvr
    echo "PARTLABEL=scrypted-nvr     /mnt/scrypted-nvr    ext4   defaults,nofail,noatime 0 0" >> /etc/fstab
    mount -a
    systemctl daemon-reload
    set +e

    DIR="/mnt/scrypted-nvr"
else
    if [ ! -d "$1" ]
    then
        echo "$1 is not a valid directory."
        exit 1
    fi

    stopscrypted

    removescryptedfstab

    DIR="$1"
fi

ESCAPED_DIR=$(echo "$DIR" | sed s/\\//\\\\\\//g)

set -e
sed -i s/'^.*:\/nvr'/"            - $ESCAPED_DIR:\/nvr"/ "$DOCKER_COMPOSE_YML"
sed -i s/'^.*SCRYPTED_NVR_VOLUME.*$'/"            - SCRYPTED_NVR_VOLUME=\/nvr"/ "$DOCKER_COMPOSE_YML"
set +e

cd $SCRYPTED_HOME
sudo -u $SERVICE_USER docker compose up -d
