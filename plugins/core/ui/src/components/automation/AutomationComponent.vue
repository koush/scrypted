<script>
import BasicComponent from "../BasicComponent.vue";

export default {
  mixins: [BasicComponent],
  methods: {
    newAutomation(scene) {
      // ugh legacy code smell
      if (scene) {
        this.newDevice("scene");
      } else {
        this.newDevice("automation");
      }
    },
  },
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
              title: "Create Automation",
              value: "automation",
              click() {
                self.newAutomation(false);
              },
            },
          ],
          description:
            "Create custom smart home actions that trigger on specific events.",
          title: "Create New Automation",
        },
        {
          body: null,
          buttons: [
            {
              method: "POST",
              path: "new",
              title: "Create Scene",
              value: "scene",
              click() {
                self.newAutomation(true);
              },
            },
          ],
          description:
            "Create custom smart home scenes that control multiple devices.",
          title: "Create New Scene",
        },
      ],
      resettable: true,
      component: {
        icon: "activity",
        id: "automation",
        name: "Automations",
      },
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
        for (const id of ids) {
          const device = this.$scrypted.systemManager.getDeviceById(id);
          const { name, type } = device;
          const pluginId = await plugins.getPluginId(device.id);
          if (pluginId !== "@scrypted/core") continue;
          const nativeId = await plugins.getNativeId(id);
          devices.push({
            id,
            name,
            type,
            nativeId,
          });
        }

        return [
          {
            name: "Automations",
            devices: devices.filter((device) =>
              device.nativeId?.startsWith("automation:")
            ),
          },
        ];
      },
      default: [
        {
          name: "Automations",
          devices: [],
        },
      ],
    },
  },
  // computed: {
  //   deviceGroups() {
  //     const ids = this.$store.state.scrypted.devices;
  //     const devices = ids
  //       .map(id => this.$scrypted.systemManager.getDeviceById(id))
  //       .filter(
  //         device =>
  //           device &&
  //           device.component &&
  //           device.component === this.component.id &&
  //           !device.owner
  //       )
  //       .map(device => ({
  //         id: device.id,
  //         name: device.name,
  //         type: device.type
  //       }));
  //     return [
  //       {
  //         name: "Automations",
  //         devices: devices.filter(device => device.type !== "Scene")
  //       },
  //       {
  //         name: "Scenes",
  //         devices: devices.filter(device => device.type === "Scene")
  //       }
  //     ];
  //   }
  // }
};
</script>