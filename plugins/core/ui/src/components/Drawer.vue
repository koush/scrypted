<template>
  <v-navigation-drawer fixed app v-model="value.drawer" clipped>
    <v-list dense nav>
      <v-subheader></v-subheader>
      <v-list-item
        v-for="item in builtinComponents"
        :key="item.id"
        link
        :to="item.path"
        :active="item.active"
        active-class="deep-purple accent-4 white--text"
      >
        <v-list-item-icon>
          <v-icon small>{{ item.icon }}</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>{{ item.name }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <div dense nav v-for="category in categories" :key="category">
        <v-subheader>{{ category }}</v-subheader>

        <v-list-item
          v-for="item in filterComponents(category)"
          :key="item.id"
          link
          :to="getComponentViewPath(item.id)"
          active-class="deep-purple accent-4 white--text"
        >
          <v-list-item-icon>
            <v-icon small>{{ item.icon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title>{{ item.name }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-divider></v-divider>
      </div>
      <v-subheader>Social</v-subheader>
      <v-list-item
        link
        href="https://discord.gg/DcFzmBHYGq"
        active-class="purple white--text tile"
      >
        <v-list-item-icon>
          <v-icon small>fab fa-discord</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Discord</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-list-item
        link
        href="https://github.com/koush/scrypted"
        active-class="purple white--text tile"
      >
        <v-list-item-icon>
          <v-icon small>fab fa-github</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title>Github</v-list-item-title>
        </v-list-item-content>
      </v-list-item>
      <v-divider></v-divider>
      <v-list-item active-class="deep-purple accent-4 white--text">
        <v-list-item-icon>
          <v-icon small>fa-code-branch</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title
            >Version {{ scryptedVersion || "Unknown" }}</v-list-item-title
          >
        </v-list-item-content>
      </v-list-item>
    </v-list>
  </v-navigation-drawer>
</template>

<script>
import { getComponentViewPath } from "./helpers";

export default {
  props: {
    value: Object,
    components: {
      type: Array,
      default() {
        return [
          {
            id: "plugin",
            name: "Plugins",
            icon: "fa-puzzle-piece",
            category: "Components",
          },
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
  computed: {
    scryptedVersion() {
      return this.$store.state.version;
    },
  },
  methods: {
    getComponentViewPath,
    filterComponents: function (category) {
      return this.components.filter(
        (component) => component.category == category
      );
    },
  },
  data: function () {
    return {
      actives: {},
      // components: [],
      builtinComponents: [
        {
          id: "dashboard",
          name: "Dashboard",
          icon: "fa-tachometer-alt",
          path: "/",
          active: false,
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
<style scoped>
</style>