<template>
  <v-layout>
    <v-flex xs12 md8 lg6>
      <v-card raised>
        <v-toolbar dark color="blue">
          All Devices
          <v-spacer></v-spacer>
          <v-text-field
            v-model="search"
            append-icon="search"
            label="Search"
            single-line
            hide-details
          ></v-text-field>
        </v-toolbar>
        <v-data-table
          :headers="headers"
          :items="tableDevices"
          :items-per-page="50"
          :search="search"
        >
          <template v-slot:[`item.icon`]="{ item }">
            <v-icon x-small :color="colors.blue.base">
              {{ typeToIcon(item.type) }}
            </v-icon>
          </template>
          <template v-slot:[`item.name`]="{ item }">
            <a link :href="'#' + getDeviceViewPath(item.id)">{{ item.name }}</a>
          </template>
          <template v-slot:[`item.plugin`]="{ item }">
            <a link :href="item.provider.link">{{ item.provider.name }}</a>
          </template>
        </v-data-table>
      </v-card>
    </v-flex>
  </v-layout>
</template>
<script>
import colors from "vuetify/es5/util/colors";
import { typeToIcon, getComponentName, getDeviceViewPath } from "./helpers";

export default {
  methods: {
    getDeviceViewPath,
    getProvider(device) {
      if (device.providerId === device.id)
        return {
          name: this.$scrypted.systemManager.getDeviceById(device.providerId).name,
          link: `#/device/${device.id}`,
        }
      return {
        name: this.$scrypted.systemManager.getDeviceById(device.providerId).name,
        link: `#/device/${device.id}`,
      }
    },
    typeToIcon,
    getMetadata(device, prop) {
      const metadata = device.metadata;
      return metadata && metadata[prop];
    }
  },
  computed: {
    devices() {
      return this.$store.state.scrypted.devices
        .map(id => this.$scrypted.systemManager.getDeviceById(id))
        .map(device => ({
          id: device.id,
          name: device.name,
          type: device.type,
          provider: this.getProvider(device),
        }));
    },
    tableDevices() {
      return this.devices.map(device =>
        Object.assign(
          {
            plugin: device.owner || device.component
          },
          device
        )
      );
    },
    headers() {
      var ret = [];
      if (this.$vuetify.breakpoint.smAndUp) {
        ret.push({
          width: 40,
          text: "",
          align: "left",
          sortable: false,
          value: "icon"
        });
      }

      ret.push({
        text: "Name",
        align: "left",
        sortable: true,
        value: "name"
      });

      if (this.$vuetify.breakpoint.smAndUp) {
        ret.push({
          text: "Type",
          align: "left",
          sortable: true,
          value: "type"
        });
      }
      if (this.$vuetify.breakpoint.mdAndUp) {
        ret.push({
          text: "Source",
          align: "left",
          sortable: true,
          value: "plugin"
        });
      }
      return ret;
    }
  },
  data: function() {
    return {
      search: "",
      colors
    };
  }
};
</script>