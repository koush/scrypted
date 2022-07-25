#!/command/execlineb -P

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