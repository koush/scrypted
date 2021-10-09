<template>
  <div>
    <v-card-text
      >{{ device.name }} can be enabled for these things.</v-card-text
    >

    <v-list-item-group>
      <v-list-item
        @click="
          mixin.enabled = !mixin.enabled;
          toggleMixin(mixin);
        "
        v-for="mixin in availableMixins"
        :key="mixin.id"
        inactive
      >
        <v-list-item-action>
          <v-checkbox
          dense
            @click.stop
            @change="toggleMixin(mixin)"
            v-model="mixin.enabled"
            color="primary"
          ></v-checkbox>
        </v-list-item-action>

        <v-list-item-content>
          <v-list-item-subtitle>{{ mixin.name }}</v-list-item-subtitle>
        </v-list-item-content>
        
        <v-list-item-icon><v-icon x-small color="grey">{{ typeToIcon(mixin.type) }}</v-icon></v-list-item-icon>
        
     
        <v-list-item-icon>
          <v-list-item-action><v-btn small @click.stop="openMixin(mixin)"><v-icon x-small>fa-external-link-alt</v-icon></v-btn></v-list-item-action>
        </v-list-item-icon>
        
      </v-list-item>
    </v-list-item-group>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DeviceGroup from "../common/DeviceTable.vue";
import { setMixin } from '../common/mixin';
import { typeToIcon, getDeviceViewPath } from "../components/helpers";

export default {
  mixins: [RPCInterface],
  components: {
    DeviceGroup,
  },
  methods: {
    typeToIcon,
    async toggleMixin(mixin) {
      const device = this.$scrypted.systemManager.getDeviceById(mixin.id);
      await setMixin(
        this.$scrypted.systemManager,
        device,
        this.device.id,
        mixin.enabled
      );
    },
    openMixin(mixin) {
        this.$router.push(getDeviceViewPath(mixin.id));
    }
  },
  computed: {
    currentMixins() {
      const devices = this.$store.state.scrypted.devices
        .map((id) => this.$scrypted.systemManager.getDeviceById(id))
        .filter((device) => {
          return device.mixins?.includes(this.device.id);
        })
        .map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
          enabled: true,
        }));
      return devices;
    },
  },
  asyncComputed: {
    availableMixins: {
      default() {
        return this.currentMixins;
      },
      async get() {
        const devices = this.$store.state.scrypted.devices.map((id) =>
          this.$scrypted.systemManager.getDeviceById(id)
        );
        const checks = await Promise.all(
          devices.map(async (device) =>
            device.mixins?.includes(this.device.id) ||
            (await this.device.canMixin(device.type, device.interfaces))
              ? device
              : undefined
          )
        );
        const found = checks.filter((check) => !!check).sort((d1, d2) => d1.id < d2.id ? -1 : 1);

        return found.map((device) => ({
          id: device.id,
          name: device.name,
          type: device.type,
          enabled: device.mixins?.includes(this.device.id),
        }));
      },
    },
  },
};
</script>