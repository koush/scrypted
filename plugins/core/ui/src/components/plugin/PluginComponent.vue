<script>
import BasicComponent from "../BasicComponent.vue";
import PluginUpdate from "./PluginUpdate.vue";
import PluginPid from "./PluginPid.vue";
import PluginStats from "./PluginStats.vue";
import { getDeviceViewPath } from "../helpers";

export default {
  mixins: [BasicComponent],
  methods: {
    getOwnerColumn(device) {
      return device.pluginId;
    },
    getOwnerLink(device) {
      return `https://www.npmjs.com/package/${device.pluginId}`;
    },
    async openAutoupdater() {
      const plugins = await this.$scrypted.systemManager.getComponent(
        "plugins"
      );
      const id = await plugins.getIdForNativeId(
        "@scrypted/core",
        "automation:update-plugins"
      );
      this.$router.push(getDeviceViewPath(id));
    },
  },
  data() {
    var self = this;
    return {
      stats: [],
      footer: PluginStats,
      cards: [
        {
          body: null,
          buttons: [
            {
              title: "Install Plugin",
              click() {
                self.$router.push(`${self.componentViewPath}/install`);
              },
            },
            {
              title: "Configure Autoupdater",
              click() {
                self.openAutoupdater();
              },
            },
          ],
          description:
            "Integrate your existing smart home devices and services.",
          title: "Install Plugin",
        },
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
    footerModel: {
      async get() {
        return (await this.deviceGroups)[0].devices;
      },
      default: [],
    },
    deviceGroups: {
      async get() {
        this.stats = [];
        const ids = Object.keys(this.$store.state.systemState);

        const devices = [];
        const plugins = await this.$scrypted.systemManager.getComponent(
          "plugins"
        );
        const promises = ids.map(async (id) => {
          const device = this.$scrypted.systemManager.getDeviceById(id);
          if (device.id !== device.providerId) return;
          const { name, type } = device;
          const pluginId = await plugins.getPluginId(device.id);
          const pluginInfo = await plugins.getPluginInfo(pluginId);
          const { packageJson, pid, stats, rpcObjects } = pluginInfo;
          const npmPackageVersion = packageJson.version;
          devices.push({
            id,
            name,
            type,
            pluginId,
            npmPackageVersion,
            pid,
            stats,
            rpcObjects,
          });
        });

        await Promise.allSettled(promises);
        devices.sort((d1, d2) => d1.name < d2.name ? -1 : d2.name < d1.name ? 1 : 0);

        return [
          {
            name: "Plugins",
            ownerColumn: "Plugin Package",
            devices,
            hideType: true,
            tableProps: {
              extraColumn0: "Version",
              extraColumn1: "PID",
            },
            extraColumn0: PluginUpdate,
            extraColumn1: PluginPid,
          },
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
            extraColumn1: "PID",
          },
          extraColumn0: PluginUpdate,
          extraColumn1: PluginPid,
        },
      ],
    },
  },
};
</script>