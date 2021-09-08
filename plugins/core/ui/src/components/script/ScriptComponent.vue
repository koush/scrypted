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
              title: "New Script",
              value: "script",
              click() {
                self.newDevice('script');
              }
            }
          ],
          description:
            "Create reuasble scripts that can run complex actions.",
          title: "Scripts"
        },
      ],
      component: {
        icon: "terminal",
        id: "script",
        name: "Scripts"
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
            name: "Scripts",
            devices: devices.filter((device) =>
              device.nativeId?.startsWith("script:")
            ),
          },
        ];
      },
      default: [
        {
          name: "Scripts",
          devices: [],
        },
      ],
    },
  },

};
</script>