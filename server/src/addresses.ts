import os from 'os';

export function getAddresses() {
    return Object.entries(os.networkInterfaces()).filter(([iface]) => iface.startsWith('en') || iface.startsWith('eth') || iface.startsWith('wlan')).map(([_, addr]) => addr).flat().map(info => info.address).filter(address => address);
}
