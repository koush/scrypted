PCT=$(which pct)
if [ -z "$PCT" ]
then
    echo "pct command not found. This script must be run on the Proxmox host, not a container."
    echo "Installation Documentation: https://docs.scrypted.app/installation.html#proxmox-ve"
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

cd /tmp
SCRYPTED_VERSION=v0.116.0
SCRYPTED_TAR_ZST=scrypted-$SCRYPTED_VERSION.tar.zst
if [ -z "$VMID" ]
then
    VMID=10443
fi

SCRYPTED_BACKUP_VMID=10445
if [ -n "$SCRYPTED_RESTORE" ]
then
    RESTORE_VMID=$VMID
    VMID=$SCRYPTED_BACKUP_VMID
    pct destroy $VMID 2>&1 > /dev/null
fi

echo "Downloading scrypted container backup."
if [ ! -f "$SCRYPTED_TAR_ZST" ]
then
    curl -O -L https://github.com/koush/scrypted/releases/download/$SCRYPTED_VERSION/scrypted.tar.zst
    mv scrypted.tar.zst $SCRYPTED_TAR_ZST
fi

if [[ "$@" =~ "--force" ]]
then
    IGNORE_EXISTING=true
fi

if [ -n "$SCRYPTED_RESTORE" ]
then
    IGNORE_EXISTING=true
fi

if [ -z "$IGNORE_EXISTING" ]
then
    echo "Checking for existing container."
    pct config $VMID
    if [ "$?" == "0" ]
    then
        echo ""
        echo "==============================================================="
        echo "Existing container $VMID found."
        echo "Please choose from the following options to resolve this error."
        echo "==============================================================="
        echo ""
        echo "1. To reinstall and reset Scrypted, run this script with --force to overwrite the existing container."
        echo "THIS WILL WIPE THE EXISTING CONFIGURATION:"
        echo ""
        echo "bash $0 --force"
        echo ""
        echo "2. To reinstall Scrypted and and retain existing configuration, run this script with the environment variable SCRYPTED_RESTORE=true."
        echo "This preserve existing data. Creating a backup within Scrypted is highly recommended in case the reset fails."
        echo "THIS WILL WIPE ADDITIONAL VOLUMES SUCH AS NVR STORAGE. NVR volumes will need to be readded after the restore:"
        echo ""
        echo "SCRYPTED_RESTORE=true bash $0"
        echo ""
        echo "3. To install an additional new Scrypted container, run this script with the environment variable specifying"
        echo "the new VMID=<number>. For example, to create a new LXC with VMID 12345:"
        echo ""
        echo "VMID=12345 bash $0"

        exit 1
    fi
fi

pct stop $VMID 2>&1 > /dev/null
pct restore $VMID $SCRYPTED_TAR_ZST $@

if [ "$?" != "0" ]
then
    echo ""
    echo "The Scrypted container installation failed (pct restore error)."
    echo ""
    echo "This may be because the server's 'local' storage device is not being a valid"
    echo "location for containers."
    echo "Try running this script again with a different storage device like"
    echo "'local-lvm' or 'local-zfs'."
    echo ""
    echo "#############################################################################"
    echo -e "\033[32mPaste the following command into this shell to install to local-lvm instead:\033[0m"
    echo ""
    echo "bash $0 --storage local-lvm"
    echo "#############################################################################"
    echo ""
    echo ""
    exit 1
fi

pct set $VMID -net0 name=eth0,bridge=vmbr0,ip=dhcp,ip6=auto
if [ "$?" != "0" ]
then
    echo ""
    echo "pct set network failed"
    echo ""
    echo "Ignoring... Please verify your container's network settings."
fi

CONF=/etc/pve/lxc/$VMID.conf
if [ -f "$CONF" ]
then
    echo "onboot: 1" >> $CONF
else
    echo "$CONF not found? Start on boot must be enabled manually."    
fi

if [ -n "$SCRYPTED_RESTORE" ]
then
    echo ""
    echo ""
    readyn "Running this script will reset the Scrypted container to a factory state while preserving existing data. IT IS RECOMMENDED TO CREATE A BACKUP INSIDE SCRYPTED FIRST. Are you sure you want to continue?"
    if [ "$yn" != "y" ]
    then
        exit 1
    fi

    echo "Stopping scrypted..."
    pct stop $RESTORE_VMID 2>&1 > /dev/null

    echo "Preparing rootfs reset..."
    pct destroy $SCRYPTED_BACKUP_VMID

    # this moves the data volume from the current scrypted instance to the backup target.
    pct set $SCRYPTED_BACKUP_VMID --delete mp0 && pct set $SCRYPTED_BACKUP_VMID --delete unused0 && pct move-volume $RESTORE_VMID mp0 --target-vmid $SCRYPTED_BACKUP_VMID --target-volume mp0
    if [ "$?" != "0" ]
    then
        echo "Failed to move data volume to backup."
        exit 1
    fi

    rm *.tar
    vzdump $SCRYPTED_BACKUP_VMID --dumpdir /tmp
    VMID=$RESTORE_VMID
    echo "Restoring with reset image..."
    pct restore --force 1 $VMID *.tar $@

    pct destroy $SCRYPTED_BACKUP_VMID
fi

readyn "Add udev rule for hardware acceleration? This may conflict with existing rules."
if [ "$yn" == "y" ]
then
    echo "Adding udev rule: /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"apex\", MODE=\"0666\"' > /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"drm\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"accel\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"1a6e\", ATTRS{idProduct}==\"089a\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"18d1\", ATTRS{idProduct}==\"9302\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    udevadm control --reload-rules && udevadm trigger
fi

# check if intel
INTEL=$(cat /proc/cpuinfo | grep GenuineIntel)
if [ ! -z "$INTEL" ]
then
    readyn "Install intel-microcode package? This will update your CPU and GPU firmware."
    if [ "$yn" == "y" ]
    then
        echo "Installing intel-microcode..."
        # remove it first to allow reinsertion
        sed -i 's/main contrib non-free-firmware/main/g' /etc/apt/sources.list
        sed -i 's/main/main contrib non-free-firmware/g' /etc/apt/sources.list
        apt update
        apt install -y intel-microcode
        echo "#############################"
        echo "System Reboot is recommended."
        echo "#############################"
    fi
fi

echo "Scrypted setup is complete and the container resources can be started."
echo ""
echo "Scrypted NVR servers should run the disk setup script in the documentation to add storage prior to starting the container."
