<script>
import BasicComponent from "../BasicComponent.vue";
import PluginUpdate from "./PluginUpdate.vue";
import PluginPid from "./PluginPid.vue";
import PluginStats from "./PluginStats.vue";
import { getDeviceViewPath } from "../helpers";
import { snapshotCurrentPlugins, getIdForNativeId } from "./plugin";

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
      const id = getIdForNativeId(systemManager, '@scrypted/core', 'scriptcore');
      this.$router.push(getDeviceViewPath(id));
    },
    async snapshotCurrentPlugins() {
      const id = await snapshotCurrentPlugins(this.$scrypted);
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
              title: "Install",
              click() {
                self.$router.push(`${self.componentViewPath}/install`);
              },
            },
            {
              title: "Auto Updates",
              click() {
                self.openAutoupdater();
              },
            },
            {
              title: "Snapshot Plugins",
              click() {
                self.snapshotCurrentPlugins();
              },
            },
          ],
          description:
            "Integrate your existing smart home devices and services.",
          title: "Plugin Management",
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
        const promises = ids.map(async (id) => {
          const device = this.$scrypted.systemManager.getDeviceById(id);
          if (device.id !== device.providerId) return;
          const { name, type } = device;
          const pluginId = device.pluginId;
          let pluginInfo;
          try {
            const plugins = await this.$scrypted.systemManager.getComponent(
              "plugins"
            );
            pluginInfo = await plugins.getPluginInfo(pluginId);
          }
          catch (e) {
          }
          const { packageJson, pid, stats, rpcObjects, pendingResults } = pluginInfo || {};
          const npmPackageVersion = packageJson?.version;
          devices.push({
            id,
            name,
            type,
            pluginId,
            npmPackageVersion,
            pid,
            stats,
            rpcObjects,
            pendingResults,
          });
        });

        await Promise.allSettled(promises);
        devices.sort((d1, d2) =>
          d1.name < d2.name ? -1 : d2.name < d1.name ? 1 : 0
        );

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