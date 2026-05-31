# BTicino Intercom Plugin for Scrypted

The C300X Plugin for Scrypted allows viewing your C300X intercom with incoming video/audio.

WARNING: You will need access to the device, see https://github.com/fquinto/bticinoClasse300x.

You also need the **[c300x-controller](https://github.com/slyoldfox/c300x-controller)** and node (v17.9.1) running on your device which will expose an API for the intercom.

## Development instructions

```
$ cd plugins/sip
$ npm ci
$ cd plugins/bticino
$ npm ci
$ npm run build
$ num run scrypted-deploy 127.0.0.1
```

After flashing a custom firmware you must at least:

* Install [node](https://nodejs.org/download/release/latest-v17.x/node-v17.9.1-linux-armv7l.tar.gz) on your device and run the c300x-controller on the device
* Install [/lib/libatomic.so.1](http://ftp.de.debian.org/debian/pool/main/g/gcc-10-cross/libatomic1-armhf-cross_10.2.1-6cross1_all.deb) in **/lib**
* Allow access to the SIP server on port 5060
* Allow your IP to authenticated with the SIP server
* Add a SIP user for scrypted

To do this use the guide below:

## Installing node and c300x-controller

```
$ cd /home/bticino/cfg/extra/
$ mkdir node
$ cd node
$ wget https://nodejs.org/download/release/latest-v17.x/node-v17.9.1-linux-armv7l.tar.gz
$ tar xvfz node-v17.9.1-linux-armv7l.tar.gz
```

Node will require libatomic.so.1 which isn't shipped with the device, get the .deb file from http://ftp.de.debian.org/debian/pool/main/g/gcc-10-cross/libatomic1-armhf-cross_10.2.1-6cross1_all.deb 

```
$ ar x libatomic1-armhf-cross_10.2.1-6cross1_all.deb 
```

scp the `libatomic.so.1` to `/lib` and check that node works:

```
$ root@C3X-00-00-00-00-00--2222222:~# /home/bticino/cfg/extra/node/bin/node -v
v17.9.1
```

## Make flexisip listen on a reachable IP and add users to it

To be able to talk to our own SIP server, we need to make the SIP server on the C300X
talk to our internal network, instead of only locally (on the `lo` interface).

Mount the root system read-write

````
$ mount -oremount,rw /
````

Change the listening ports by appending some arguments in `/etc/init.d/flexisipsh`

(look at the end of the line, change to the IP of your C300X)

```
case "$1" in
  start)
    start-stop-daemon --start --quiet --exec $DAEMON -- $DAEMON_ARGS --transports "sips:$2:5061;maddr=$2;require-peer-certificate=1 sip:127.0.0.1;maddr=127.0.0.1 sip:192.168.0.XX;maddr=192.168.0.XX"
;;
```

You can also change it to - `$2`, the script will then put in the current wifi IP.

````
start-stop-daemon --start --quiet --exec $DAEMON -- $DAEMON_ARGS --transports "sips:$2:5061;maddr=$2;require-peer-certificate=1 sip:127.0.0.1;maddr=127.0.0.1 sip:$2;maddr=$2"
````

The intercom is firewalled, the easiest way is to remove the firewall file (or move it to somewhere on `/home/bticino/cfg/extra` which is a kind of permanent storage)

If you don't want to do that yet, drop the firewall rules from command line: (IMPORTANT: needs to be repeated after each reboot)

````
iptables -P INPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P OUTPUT ACCEPT
````

If you are sick of repeating these commands every time you reboot:

````
mv /etc/network/if-pre-up.d/iptables /home/bticino/cfg/extra/iptables.bak
mv /etc/network/if-pre-up.d/iptables6 /home/bticino/cfg/extra/iptables6.bak
````

Edit the `/home/bticino/cfg/flexisip.conf` so `baresip` can authenticate with it.

Set `log-level` and `syslog-level` to `debug` (it logs to `/var/log/log_rotation.log`)

In `trusted-hosts` add the IP address of the server where you will run `baresip`.
This makes sure we don’t need to bother with the initial authentication of username/password.

Hosts in `trusted-hosts` can register without needing to authenticate.

````
[global]
...
log-level=debug
syslog-level=debug

[module::Authentication]
enabled=true
auth-domains=c300x.bs.iotleg.com
db-implementation=file
datasource=/etc/flexisip/users/users.db.txt
trusted-hosts=127.0.0.1 192.168.0.XX
hashed-passwords=true
reject-wrong-client-certificates=true
````

Now we will add a `user agent` (user) that will be used by `scrypted` to register itself with `flexisip`

Edit the `/etc/flexisip/users/users.db.txt` file and create a new line by copy/pasting the c300x user.

For example:

````
c300x@1234567.bs.iotleg.com md5:ffffffffffffffffffffffffffffffff ;
scrypted@1234567.bs.iotleg.com md5:ffffffffffffffffffffffffffffffff ;
````

Leave the md5 as the same value - I use `fffff....` just for this example.

Edit the `/etc/flexisip/users/route.conf` file and add a new line to it, it specifies where this user can be found on the network.
Change the IP address to the place where you will run `baresip` (same as `trusted-hosts` above)

````
<sip:scrypted@1234567.bs.iotleg.com> <sip:192.168.0.XX>
````

Edit the `/etc/flexisip/users/route_int.conf` file.

This file contains one line that starts with `<sip:alluser@...` it specifies who will be called when someone rings the doorbell.

You can look at it as a group of users that is called when you call `alluser@1234567.bs.iotleg.com`

Add your username at the end (make sure you stay on the same line, NOT a new line!)
````
<sip:alluser@1234567.bs.iotleg.com> ..., <sip:scrypted@1234567.bs.iotleg.com>
````

Reboot and verify flexisip is listening on the new IP address.

````
~# ps aux|grep flexis
bticino    741  0.0  0.3   9732  1988 ?        SNs  Oct28   0:00 /usr/bin/flexisip --daemon --syslog --pidfile /var/run/flexisip.pid --p12-passphrase-file /var/tmp/bt_answering_machine.fifo --transports sips:192.168.0.XX:5061;maddr=192.168.0.XX;require-peer-certificate=1 sip:127.0.0.1;maddr=127.0.0.1  sip:192.168.0.XX;maddr=192.168.0.XX
bticino    742  0.1  1.6  45684  8408 ?        SNl  Oct28   1:44 /usr/bin/flexisip --daemon --syslog --pidfile /var/run/flexisip.pid --p12-passphrase-file /var/tmp/bt_answering_machine.fifo --transports sips:192.168.0.XX:5061;maddr=192.168.0.XX;require-peer-certificate=1 sip:127.0.0.1;maddr=127.0.0.1  sip:192.168.0.XX;maddr=192.168.0.XX