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
SCRYPTED_VERSION=v0.80.0
SCRYPTED_TAR_ZST=scrypted-$SCRYPTED_VERSION.tar.zst
if [ -z "$VMID" ]
then
    VMID=10443
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
    echo "pct restore failed"
    echo ""
    echo "This may be caused by the server's 'local' storage not supporting containers."
    echo "Try running this script again with a different storage device (local-lvm, local-zfs). For example:"
    echo ""
    echo "bash $0 --storage local-lvm"
    echo ""
    exit 1
fi

echo "Adding udev rule: /etc/udev/rules.d/65-scrypted.rules"
readyn "Add udev rule for hardware acceleration? This may conflict with existing rules."
if [ "$yn" == "y" ]
then
    sh -c "echo 'SUBSYSTEM==\"apex\", MODE=\"0666\"' > /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'KERNEL==\"renderD128\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    sh -c "echo 'KERNEL==\"card0\", MODE=\"0666\"' >> /etc/udev/rules.d/65-scrypted.rules"
    udevadm control --reload-rules && udevadm trigger
fi

echo "Scrypted setup is complete and the container resources can be started."
echo "Scrypted NVR users should provide at least 4 cores and 16GB RAM prior to starting."

