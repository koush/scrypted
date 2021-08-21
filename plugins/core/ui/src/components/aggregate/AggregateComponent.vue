<script>
import BasicComponent from "../BasicComponent.vue";

export default {
  mixins: [BasicComponent],
  data() {
    var self = this;
    return {
      cards: [
        {
          body: null,
          buttons: [
            {
              method: "POST",
              path: "new",
              title: "Create Device Group",
              value: "aggregate",
              click() {
                self.newDevice('aggregate');
              }
            }
          ],
          description:
            "Combine multiple devices into a single virtual device. Commands sent to the device group will be sent to all the devices in that group.",
          title: "New Device Group"
        },
      ],
      component: {
        icon: "folder-plus",
        id: "aggregate",
        name: "Device Groups"
      }
    };
  },
  asyncComputed: {
    deviceGroups: {
      async get() {
        const ids = Object.keys(this.$store.state.systemState);

        const devices = [];
        const plugins = await this.$scrypted.systemManager.getComponent(
          "plugins"
        );
        const promises = ids.map(async (id) => {
          const device = this.$scrypted.systemManager.getDeviceById(id);
          const { name, type } = device;
          const pluginId = await plugins.getPluginId(device.id);
          if (pluginId !== "@scrypted/core") return;
          const nativeId = await plugins.getNativeId(id);
          devices.push({
            id,
            name,
            type,
            nativeId,
          });
        });

        await Promise.allSettled(promises);

        return [
          {
            name: "Aggregate Devices",
            devices: devices.filter((device) =>
              device.nativeId?.startsWith("aggregate:")
            ),
          },
        ];
      },
      default: [
        {
          name: "Aggregate Devices",
          devices: [],
        },
      ],
    },
  },

};
</script>