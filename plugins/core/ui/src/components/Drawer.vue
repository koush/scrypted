<template>
  <v-navigation-drawer fixed app v-model="value.drawer" clipped :color="$vuetify.theme.dark ? undefined : '#F0F0F0'">
    <v-list dense nav>
      <v-subheader></v-subheader>

      <v-list-item link href="#/component/settings" v-if="updateAvailable"
        active-class="deep-purple accent-4 white--text">
        <v-list-item-icon>
          <v-icon color="red" small>fa-download</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Update {{ updateAvailable }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <v-list-item v-for="item in builtinComponents" :key="item.id" link :to="item.path" :active="item.active"
        active-class="deep-purple accent-4 white--text">
        <v-list-item-icon>
          <v-icon small>{{ item.icon }}</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>{{ item.name }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <v-divider></v-divider>
      <template v-for="category in categories" >
        <v-subheader>{{ category }}</v-subheader>

        <v-list-item v-for="item in filterComponents(category)" :key="item.id" link :to="getComponentViewPath(item.id)"
          active-class="deep-purple accent-4 white--text">
          <v-list-item-icon>
            <v-icon small>{{ item.icon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title>{{ item.name }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-divider></v-divider>
      </template>
      <v-subheader>Social</v-subheader>
      <v-list-item link href="https://discord.gg/DcFzmBHYGq" active-class="purple white--text tile">
        <v-list-item-icon>
          <v-icon small>fab fa-discord</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Discord</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <v-list-item link href="https://www.reddit.com/r/Scrypted/" active-class="purple white--text tile">
        <v-list-item-icon>
          <v-icon small>fab fa-reddit</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Reddit</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <v-list-item link href="https://github.com/koush/scrypted" active-class="purple white--text tile">
        <v-list-item-icon>
          <v-icon small>fab fa-github</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Github</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <v-divider></v-divider>
      <v-subheader>Other</v-subheader>
      <v-list-item link href="https://docs.scrypted.app" active-class="purple white--text tile">
        <v-list-item-icon>
          <v-icon small>fa fa-file-text</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Documentation</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list-item active-class="deep-purple accent-4 white--text">
        <v-list-item-icon>
          <v-icon small>fa-code-branch</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Version {{ scryptedVersion || "Unknown" }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<script>
import { getComponentViewPath } from "./helpers";
import { checkServerUpdate } from "./plugin/plugin";

export default {
  props: {
    value: Object,
    components: {
      type: Array,
      default() {
        return [
          {
            id: "automation",
            name: "Automations",
            icon: "fa-bolt",
            category: "Components",
          },
          {
            id: "aggregate",
            name: "Device Groups",
            icon: "fa-folder-plus",
            category: "Components",
          },
          {
            id: "script",
            name: "Scripts",
            icon: "fa-terminal",
            category: "Components",
          },
          // { id: "log", name: "Live Log", icon: "list", category: "Utilities" },
          {
            id: "users",
            name: "Users",
            icon: "fa-users",
            category: "Utilities",
          },
          {
            id: "shell",
            name: "Terminal",
            icon: "fa-terminal",
            category: "Utilities",
          },
          {
            id: "settings",
            name: "Settings",
            icon: "fa-cog",
            category: "Utilities",
          },
        ];
      },
    },
  },
  mounted() {
    this.checkUpdateAvailable();
  },
  computed: {
    scryptedVersion() {
      return this.$store.state.version;
    },
  },
  methods: {
    getComponentViewPath,
    async checkUpdateAvailable() {
      await this.$connectingScrypted;
      const serviceControl = await this.$scrypted.systemManager.getComponent(
        "service-control"
      );
      try {
        this.updateAvailable = await serviceControl.getUpdateAvailable();
      }
      catch (e) {
        // old scrypted servers dont support this call, or it may be unimplemented
        // in which case fall back and determine what the install type is.
        const info = await this.$scrypted.systemManager.getComponent("info");
        const version = await info.getVersion();
        const scryptedEnv = await info.getScryptedEnv();
        this.currentVersion = version;
        const { updateAvailable } = await checkServerUpdate(this.$scrypted.mediaManager, version, scryptedEnv.SCRYPTED_INSTALL_ENVIRONMENT);
        this.updateAvailable = updateAvailable;
      }

      if (this.updateAvailable) {
        const logger = this.$scrypted.deviceManager.getDeviceLogger();
        const u = new URL(window.location)
        u.hash = "#/component/settings";
        logger.clearAlerts();
        logger.a(`Scrypted Server update available: ${this.updateAvailable}. ${u}`);
      }
    },
    filterComponents: function (category) {
      return this.components.filter(
        (component) => component.category == category
      );
    },
  },
  data: function () {
    return {
      updateAvailable: null,
      actives: {},
      builtinComponents: [
        {
          id: "plugin",
          name: "Plugins",
          icon: "fa-puzzle-piece",
          path: '/component/plugin',
        },
        {
          id: "devices",
          name: "Devices",
          icon: "fa-list",
          path: "/device",
          active: false,
        },
      ],
      categories: ["Components", "Utilities"],
    };
  },
};
</script>
<style scoped></style>