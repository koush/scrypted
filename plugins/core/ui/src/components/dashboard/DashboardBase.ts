import { typeToIcon } from "../helpers";

export default {
  props: ['deviceId', 'deviceIds'],
  methods: {
    typeToIcon,
  },
  destroyed() {
    this.$emit('destroyed');
  },
  computed: {
    device() {
      const device = this.$scrypted.systemManager.getDeviceById(this.deviceId);
      if (device.interfaces.includes("Refresh")) {
        const listener = device.listen(null, () => { });
        this.$once('destroyed', () => {
          listener.removeListener();
        });
      }
      return device;
    },
    devices() {
      const devices = this.deviceIds.map(deviceId => this.$scrypted.systemManager.getDeviceById(deviceId));

      const listeners = [];
      devices.forEach(device => {
        if (device.interfaces.includes("Refresh")) {
          listeners.push(device.listen(null, () => { }));
        }
      });

      this.$once('destroyed', () => listeners.forEach(listener => {
        listener.removeListener(); }
      ));

      return devices;
    },
  }
};
