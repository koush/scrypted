<template>
  <v-flex xs12>
    <v-card-actions v-if="
      device.interfaces.includes('DeviceCreator') ||
      device.interfaces.includes('DeviceDiscovery')
    ">
      <v-dialog max-width="600px" v-model="showCreateDeviceSettings" v-if="showCreateDeviceSettings">
        <Settings v-model="createDeviceSettings" custom-title="Add New" class="pa-2">
          <template v-slot:prepend>
            <v-alert v-if="createError" type="error">{{ createError }}</v-alert>
          </template>
          <template v-slot:append>
            <v-card-actions>
              <v-spacer></v-spacer>
              <v-btn text color="primary" @click="createDevice">Create</v-btn>
            </v-card-actions>
          </template>
        </Settings>
      </v-dialog>
      <v-btn v-if="device.interfaces.includes('DeviceCreator')" text color="primary"
        @click="openDeviceCreationDialog()">Add
        New</v-btn>
      <v-btn v-if="device.interfaces.includes('DeviceDiscovery')" @click="discoverDevices" text color="primary">Discover
        Devices</v-btn>
    </v-card-actions>

    <v-simple-table v-if="discoveredDevices && discoveredDevices.length">
      <thead>
        <tr>
          <th style="width: 10px;"></th>
          <th>Discovered</th>
          <th></th>
        </tr>
      </thead>
      <tbody v-if="discoveredDevices.length">
        <tr v-for="device in discoveredDevices" :key="device.id">
          <td>
            <v-btn x-small outlined fab color="info" @click="openDeviceAdoptionDialog(device)">
              <v-icon>fa-solid
                fa-plus</v-icon>
            </v-btn>
          </td>
          <td>
            {{ device.name }}
          </td>
          <td> {{ device.description }}</td>
        </tr>
      </tbody>
      <tbody v-else>
        <td></td>
        <td>None found.</td>
        <td></td>
      </tbody>
    </v-simple-table>


    <v-card-text>These things were created by {{ device.name }}.</v-card-text>
    <v-text-field v-if="managedDevices.devices.length > 10" v-model="search" append-icon="search" label="Search"
      single-line hide-details></v-text-field>
    <v-data-table v-if="managedDevices.devices.length > 10" :headers="headers" :items="managedDevices.devices"
      :items-per-page="10" :search="search">
      <template v-slot:[`item.icon`]="{ item }">
        <v-icon x-small color="grey">
          {{ typeToIcon(item.type) }}
        </v-icon>
      </template>
      <template v-slot:[`item.name`]="{ item }">
        <a v-if="!item.nativeId" link :href="'#' + getDeviceViewPath(item.id)">{{ item.name }}</a>
        <div v-else>{{ item.name }}</div>
        <div v-if="item.description">{{ item.description }}</div>
      </template>
    </v-data-table>

    <DeviceGroup v-else :deviceGroup="managedDevices"></DeviceGroup>
  </v-flex>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Settings from "./Settings.vue";
import DeviceGroup from "../common/DeviceTable.vue";
import { typeToIcon, getDeviceViewPath } from "../components/helpers";
import { ScryptedInterface } from "@scrypted/types";

export default {
  mixins: [RPCInterface],
  data() {
    return {
      adopting: false,
      discoveredDevices: [],
      adoptListener: null,
      createError: '',
      showCreateDeviceSettings: false,
      showCreateDevice: false,
      createDeviceSettings: null,
      search: "",
    };
  },
  components: {
    Settings,
    DeviceGroup,
  },
  mounted() {
    this.adoptListener = this.device.listen(ScryptedInterface.DeviceDiscovery, (s, e, d) => {
      this.discoveredDevices = d;
    })
  },
  unmounted() {
    this.adoptListener.removeListener();
  },
  methods: {
    typeToIcon,
    getDeviceViewPath,

    async openDeviceAdoptionDialog(d) {
      this.openDeviceCreationDialog(d);
      this.adopting = d.nativeId;
    },
    async createDevice() {
      const settings = {};
      for (const setting of this.createDeviceSettings.settings) {
        settings[setting.key] = setting.value;
      }
      try {
        if (this.adopting) {
          const id = await this.device.adoptDevice({
            nativeId: this.adopting,
            settings,
          });
          this.$router.push(getDeviceViewPath(id));
        }
        else {
          const id = await this.device.createDevice(settings);
          this.$router.push(getDeviceViewPath(id));
        }
      }
      catch (e) {
        this.createError = e.message;
      }
    },
    async openDeviceCreationDialog(d) {
      this.adopting = undefined;
      const settings = d ? (d.settings || []) : await this.device.getCreateDeviceSettings();
      if (settings?.length) {
        for (const setting of settings) {
          setting.value = setting.value || null;
        }

        this.createDeviceSettings = {
          settings,
        };
        this.showCreateDeviceSettings = true;
      }
      else {
        try {
          const id = await this.device.createDevice([]);
          this.$router.push(getDeviceViewPath(id));
        }
        catch (e) {
          this.createError = e.message;
        }
      }
    },
    async discoverDevices() {
      this.discoveredDevices = await this.rpc().discoverDevices(true);
    }
  },
  computed: {
    headers() {
      var ret = [];
      ret.push({
        width: 40,
        text: "",
        align: "left",
        sortable: false,
        value: "icon",
      });

      ret.push({
        text: "Name",
        align: "left",
        sortable: true,
        value: "name",
      });

      ret.push({
        text: "Type",
        align: "left",
        sortable: true,
        value: "type",
      });
      return ret;
    },
    managedDevices() {
      const devices = this.$store.state.scrypted.devices
        .filter(
          (id) =>
            this.$store.state.systemState[id].providerId.value ===
            this.device.id && this.device.id !== id
        )
        .map((id) => ({
          id,
          name: this.$store.state.systemState[id].name.value,
          type: this.$store.state.systemState[id].type.value,
        }));

      return {
        devices,
      };
    },
  },
};
</script>
