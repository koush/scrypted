<template>
  <v-menu text close-on-click bottom>
    <template v-slot:activator="{ on, attrs }">
      <v-btn
        small
        dark
        :color="pluginData.updateAvailable ? 'orange' : 'blue'"
        v-bind="attrs"
        v-on="on"
      >
        {{ menuName }}
        <v-icon right>fa-caret-down</v-icon>
      </v-btn>
    </template>

    <v-list dense v-if="pluginData.versions" >
      <v-list-item @click="openNpm" color="orange" :input-value="true">
        <v-list-item-title>View on NPM</v-list-item-title>
        <v-list-item-icon><v-icon>fab fa-npm</v-icon></v-list-item-icon>
        <v-divider></v-divider>
      </v-list-item>
      <div v-for="(item, index) in versions" :key="index">
        <v-subheader v-if="index === 0">Install Latest Release</v-subheader>
        <v-divider v-if="index === 1"></v-divider>
        <v-subheader v-if="index === 1">Install Older Release</v-subheader>
        <v-list-item
          @click="installVersion(item.version)"
          :color="releaseColor(item.tag)"
          :input-value="!!releaseColor(item.tag)"
        >
          <v-list-item-title>{{
            item.version + (item.tag ? ` (${item.tag})` : "")
          }}</v-list-item-title>
        </v-list-item>
      </div>
    </v-list>
    <v-list v-else> </v-list>
  </v-menu>
</template>
<script>
import { getNpmPath, installNpm } from "./plugin";
export default {
  props: ["pluginData"],
  computed: {
    menuName() {
      if (this.pluginData.updateAvailable) return "Update Available";
      return `${this.pluginData.packageJson.name}@${this.pluginData.packageJson.version}`;
    },
    versions() {
      return this.pluginData.versions.slice(0, 10);
    },
  },
  methods: {
    releaseColor(tag) {
      if (tag === "latest") return "green";
      if (tag === "beta") return "red";
      if (tag === "installed") return "purple";
    },
    openNpm() {
      window.open(getNpmPath(this.pluginData.packageJson.name), "npm");
    },
    async installVersion(version) {
      await installNpm(
        this.$scrypted.systemManager,
        this.pluginData.pluginId,
        version === this.pluginData.updateAvailable ? undefined : version
      );
      this.$emit("installed");
    },
  },
};
</script>
