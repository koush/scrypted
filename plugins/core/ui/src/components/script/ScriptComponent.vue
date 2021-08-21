<script>
import BasicComponent from "../BasicComponent.vue";
import PluginUpdate from "./PluginUpdate.vue";
import Stats from "./Stats.vue";
import PluginPid from "./PluginPid.vue";

export default {
  mixins: [BasicComponent],
  components: {
    Stats,
  },
  methods: {
    getOwnerColumn(device) {
      return device.pluginId;
    },
    getOwnerLink(device) {
      return `https://www.npmjs.com/package/${device.pluginId}`;
    },
  },
  data() {
    var self = this;
    return {
      // footer: "Stats",
      cards: [
        {
          body: null,
          buttons: [
            {
              method: "GET",
              path: "install",
              title: "Install Plugin",
              click() {
                self.$router.push(`${self.componentViewPath}/install`);
              },
            },
          ],
          description:
            "Integrate your existing smart home devices and services.",
          title: "Install Plugin",
        },
        // {
        //   body: null,
        //   buttons: [
        //     {
        //       method: "POST",
        //       path: "new",
        //       title: "Create Script",
        //       click() {
        //         self.newDevice();
        //       },
        //     },
        //   ],
        //   description:
        //     "Write custom scripts to automate events or add new devices.",
        //   title: "Create New Script",
        // },
      ],
      resettable: true,
      component: {
        icon: "zap",
        id: "script",
        name: "Plugins",
      },
    };
  },
  asyncComputed: {
    deviceGroups: {
      async get() {
        const ids = Object.keys(this.$store.state.systemState);

        const devices = [];
        const plugins = await this.$scrypted.systemManager.getComponent("plugins");
        const promises = ids.map(async (id) => {
            const device = this.$scrypted.systemManager.getDeviceById(id);
            if (device.id !== device.providerId)
              return;
            const {name, type} = device;
            const pluginId = await plugins.getPluginId(device.id);
            const packageJson = await plugins.getPackageJson(pluginId);
            const pid = await plugins.getPluginProcessId(pluginId);
            const npmPackageVersion = packageJson.version;
            devices.push({
              id,
              name,
              type,
              pluginId,
              npmPackageVersion,
              pid,
            })
        });

        await Promise.allSettled(promises);

        return [
          {
            name: "Plugins",
            ownerColumn: "Plugin Package",
            devices,
            hideType: true,
            tableProps: {
              extraColumn0: "Version",
              // extraColumn1: "PID",
            },
            extraColumn0: PluginUpdate,
            // extraColumn1: PluginPid,
          },
          // {
          //   name: "Scripts",
          //   devices: devices.filter(
          //     device =>
          //       !device.metadata.npmPackage && !device.metadata.ownerPlugin
          //   )
          // }
        ];
      },
      default: [
        {
          name: "Plugins",
          ownerColumn: "Plugin Package",
          devices: [],
          hideType: true,
          tableProps: {
            extraColumn0: "Version",
            // extraColumn1: "PID",
          },
          extraColumn0: PluginUpdate,
          // extraColumn1: PluginPid,
        },
        // {
        //   name: "Scripts",
        //   devices: devices.filter(
        //     device =>
        //       !device.metadata.npmPackage && !device.metadata.ownerPlugin
        //   )
        // }
      ],
    },
  },
};
</script>