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
        active-class="purple white--text tile"
      >
        <v-list-item-icon>
            <v-icon small>{{ item.icon }}</v-icon>
        </v-list-item-icon>

        <v-list-item-content>
          <v-list-item-title >{{ item.name }}</v-list-item-title>
        </v-list-item-content>
      </v-list-item>

      <div dense nav v-for="category in categories" :key="category">
        <v-subheader>{{ category }}</v-subheader>

        <v-list-item
          v-for="item in filterComponents(category)"
          :key="item.id"
          link
          :to="getComponentViewPath(item.id)"
          active-class="purple white--text tile"
        >
          <v-list-item-icon>
            <v-icon small>{{ item.icon }}</v-icon>
          </v-list-item-icon>

          <v-list-item-content>
            <v-list-item-title >{{ item.name }}</v-list-item-title>
          </v-list-item-content>
        </v-list-item>
        <v-divider></v-divider>
      </div>
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
            id: "script",
            name: "Plugins",
            icon: "fa-puzzle-piece",
            category: "Components"
          },
          {
            id: "automation",
            name: "Automations",
            icon: "fa-bolt",
            category: "Components"
          },
          {
            id: "aggregate",
            name: "Device Groups",
            icon: "fa-folder-plus",
            category: "Components"
          },
          { id: "log", name: "Live Log", icon: "list", category: "Utilities" },
          // {
          //   id: "settings",
          //   name: "Settings",
          //   icon: "fa-cog",
          //   category: "Utilities"
          // }
        ];
      }
    }
  },
  methods: {
    getComponentViewPath,
    filterComponents: function(category) {
      return this.components.filter(
        component => component.category == category
      );
    }
  },
  data: function() {
    return {
      actives: {},
      // components: [],
      builtinComponents: [
        {
          id: "dashboard",
          name: "Dashboard",
          icon: "fa-tachometer-alt",
          path: "/",
          active: false
        },
        {
          id: "devices",
          name: "Devices",
          icon: "fa-list",
          path: "/device",
          active: false
        }
      ],
      categories: ["Components", "Utilities"]
    };
  }
};
</script>
<style scoped>

</style>