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
SCRYPTED_VERSION=v0.96.0
SCRYPTED_TAR_ZST=scrypted-$SCRYPTED_VERSION.tar.zst
if [ -z "$VMID" ]
then
    VMID=10443
fi

if [ -n "$SCRYPTED_RESTORE" ]
then
    RESTORE_VMID=$VMID
    VMID=10444
    pct destroy $VMID 2>&1 > /dev/null
fi

echo "Downloading scrypted container backup."
if [ ! -f "$SCRYPTED_TAR_ZST" ]
then
    curl -O -L https://github.com/koush/scrypted/releases/download/$SCRYPTED_VERSION/scrypted.tar.zst
    mv scrypted.tar.zst $SCRYPTED_TAR_ZST
fi

echo "Checking for existing container."
pct config $VMID
if [ "$?" == "0" ]
then
    echo ""
    echo "Existing container $VMID found. Run this script with --force to overwrite the existing container."
    echo "This will wipe all existing data. Clone the existing container to retain the data, then reassign the owner of the scrypted volume after installation is complete."
    echo ""
    echo "bash $0 --force"
    echo ""
fi

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
    echo "Paste the following command into this shell to install to local-lvm instead:"
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
    readyn "Running this script will reset Scrypted to a factory state while preserving existing data. IT IS RECOMMENDED TO CREATE A BACKUP FIRST. Are you sure you want to continue?"
    if [ "$yn" != "y" ]
    then
        exit 1
    fi

    echo "Preparing rootfs reset..."
    # this copies the 
    pct set 10444 --delete mp0 && pct set 10444 --delete unused0 && pct move-volume $RESTORE_VMID mp0 --target-vmid 10444 --target-volume mp0

    rm *.tar
    vzdump 10444 --dumpdir /tmp
    VMID=$RESTORE_VMID
    echo "Moving data volume to backup..."
    pct restore $VMID *.tar $@

    pct destroy 10444
fi

echo "Adding udev rule: /etc/udev/rules.d/65-scrypted.rules"
readyn "Add udev rule for hardware acceleration? This may conflict with existing rules."
if [ "$yn" == "y" ]
then
    sh -c "echo 'SUBSYSTEM==\"apex\", MODE=\"0666\"' > /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'KERNEL==\"renderD128\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'KERNEL==\"card0\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'KERNEL==\"accel0\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"1a6e\", ATTRS{idProduct}==\"089a\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'SUBSYSTEM==\"usb\", ATTRS{idVendor}==\"18d1\", ATTRS{idProduct}==\"9302\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    udevadm control --reload-rules && udevadm trigger
fi

echo "Scrypted setup is complete and the container resources can be started."
echo "Scrypted NVR users should provide at least 4 cores and 16GB RAM prior to starting."
