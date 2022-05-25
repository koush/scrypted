<template>
  <div>
    <v-checkbox
      v-if="lazyValue.type === 'boolean'"
      dense
      :readonly="lazyValue.readonly"
      v-model="booleanValue"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      :placeholder="lazyValue.placeholder"
      persistent-hint
      @change="save"
      :class="lazyValue.description ? 'mb-2' : ''"
    ></v-checkbox>
    <div v-else-if="lazyValue.type === 'qrcode'">
      <div class="subtitle-2"> {{ lazyValue.title }}</div>
      <v-img :src="qrcode"></v-img>
    </div>
    <div v-else-if="lazyValue.type === 'button'" @click="save">
      <v-btn small block> {{ lazyValue.title }} </v-btn>
      <span v-if="lazyValue.description" class="caption pl-1">{{
        lazyValue.description
      }}</span>
    </div>
    <v-combobox
      v-else-if="lazyValue.choices && lazyValue.combobox"
      dense
      :readonly="lazyValue.readonly"
      :items="lazyValue.choices"
      :multiple="lazyValue.multiple"
      :small-chips="lazyValue.multiple"
      v-model="lazyValue.value"
      outlined
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :placeholder="lazyValue.placeholder"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-combobox>
    <v-select
      v-else-if="lazyValue.choices"
      dense
      :readonly="lazyValue.readonly"
      :items="lazyValue.choices"
      :multiple="lazyValue.multiple"
      :small-chips="lazyValue.multiple"
      v-model="lazyValue.value"
      outlined
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :placeholder="lazyValue.placeholder"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-select>
    <DevicePicker
      v-else-if="lazyValue.type === 'device'"
      v-model="lazyValue.value"
      :multiple="lazyValue.multiple"
      :devices="devices"
      :title="lazyValue.title"
      :description="lazyValue.description"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </DevicePicker>
    <DevicePicker
      v-else-if="lazyValue.type === 'interface'"
      v-model="lazyValue.value"
      :multiple="lazyValue.multiple"
      :devices="interfaces"
      :title="lazyValue.title"
      :description="lazyValue.description"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </DevicePicker>
    <div v-else-if="lazyValue.type === 'clippath'" class="mb-2">
      <v-btn small block @click="editZone">{{ lazyValue.title }} </v-btn>
      <Camera
        :value="device"
        :device="device"
        :clipPathValue="sanitizedClipPathValue"
        :showDialog="editingZone"
        :hidePreview="true"
        @dialog="editingZoneChanged"
        @clipPath="lazyValue.value = $event"
      ></Camera>
    </div>
    <v-text-field
      autocomplete="off"
      autocorrect="off"
      autocapitalize="off"
      spellcheck="false"
      v-else
      dense
      :readonly="lazyValue.readonly"
      outlined
      v-model="lazyValue.value"
      :placeholder="lazyValue.placeholder"
      :label="lazyValue.title"
      :hint="lazyValue.description"
      persistent-hint
      :type="lazyValue.type === 'password' ? 'password' : undefined"
    >
      <template v-slot:append-outer>
        <v-btn
          v-if="dirty && device"
          color="success"
          text
          @click="save"
          class="shift-up"
        >
          <v-icon>send</v-icon>
        </v-btn>
      </template>
    </v-text-field>
  </div>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import DevicePicker from "../common/DevicePicker.vue";
import Grower from "../common/Grower.vue";
import cloneDeep from "lodash/cloneDeep";
import Camera from "./Camera.vue";
import qrcode from "qrcode";

export default {
  mixins: [RPCInterface],
  components: {
    Camera,
    DevicePicker,
    Grower,
  },
  data() {
    return {
      editingZone: false,
    };
  },
  watch: {
    dirty() {
      if (this.device) return;
      this.onInput();
    },
  },
  asyncComputed: {
    qrcode: {
      async get() {
        if (this.lazyValue.type !== "qrcode") return;

        let color;
        if (this.$vuetify.theme.dark) {
          color = {
            dark: "#FFFFFFFF",
            light: "#FF000000",
          };
        } else {
          color = {
            light: "#FFFFFFFF",
            dark: "#404040FF",
          };
        }

        return qrcode.toDataURL(this.lazyValue.value, {
          margin: 0.5,
          color,
          width: 320,
          rendererOpts: {
            type: "image/jpeg",
          },
        });
      },
      default: "https://poops.com/farts.jpg",
    },
  },
  computed: {
    sanitizedClipPathValue() {
      try {
        return JSON.parse(JSON.stringify(this.lazyValue.value)) || [];
      } catch (e) {
        return [];
      }
    },
    booleanValue: {
      get() {
        return (
          this.lazyValue.value &&
          this.lazyValue.value.toString().toLowerCase() === "true"
        );
      },
      set(val) {
        this.lazyValue.value = val.toString();
      },
    },
    dirty() {
      return (
        JSON.stringify(this.lazyValue.value) !==
        JSON.stringify(this.value.value)
      );
    },
    devices() {
      var expression;
      try {
        expression = this.lazyValue.deviceFilter || "true;";
        // var interfaces = this.$scrypted.systemManager.getDeviceById(id).interfaces.map(iface => `var ${iface} = true`);
      } catch (e) {
        expression = "true;";
      }
      var ret = this.$store.state.scrypted.devices
        .map((id) => this.$scrypted.systemManager.getDeviceById(id))
        .filter((device) => {
          try {
            return eval(
              `(function() { var interfaces = ${JSON.stringify(
                device.interfaces
              )}; var type='${device.type}'; return ${expression} })`
            )();
          } catch (e) {
            return true;
          }
        })
        .map((device) => ({
          id: device.id,
          text: device.name,
        }));
      if (!this.lazyValue.multiple) {
        ret.splice(0, 0, {
          id: null,
          text: this.lazyValue.placeholder || "Select a Device",
        });
      }
      return ret;
    },
    interfaces() {
      var expression;
      try {
        expression = this.lazyValue.deviceFilter || "true;";
        // var interfaces = this.$scrypted.systemManager.getDeviceById(id).interfaces.map(iface => `var ${iface} = true`);
      } catch (e) {
        expression = "true;";
      }
      var ret = this.$store.state.scrypted.devices
        .map((id) => {
          const device = this.$scrypted.systemManager.getDeviceById(id);
          return device.interfaces.map((iface) => ({
            device,
            deviceInterface: iface,
          }));
        })
        .flat()
        .filter(({ device, deviceInterface }) => {
          try {
            return eval(
              `(function() { var interfaces = ${JSON.stringify(
                device.interfaces
              )}; var deviceInterface = '${deviceInterface}'}; var type='${
                device.type
              }'; return ${expression} })`
            )();
          } catch (e) {
            return true;
          }
        })
        .map(({ device, deviceInterface }) => ({
          id: device.id + "#" + deviceInterface,
          text: device.name + ` (${deviceInterface})`,
        }));
      if (!this.lazyValue.multiple) {
        ret.splice(0, 0, {
          id: null,
          text: this.lazyValue.placeholder || "Select an Interface",
        });
      }
      return ret;
    },
  },
  methods: {
    onChange() {},
    editingZoneChanged(value) {
      this.editingZone = value;
      if (!value) {
        this.rpc().putSetting(
          this.lazyValue.key,
          this.createInputValue().value
        );
        this.onInput();
      }
    },
    createLazyValue() {
      var type = this.value.type || "";
      if (type.indexOf("[]") == -1 && type !== "clippath") {
        return cloneDeep(this.value);
      }

      var ret = cloneDeep(this.value);
      try {
        ret.value = JSON.parse(ret.value);
      } catch (e) {
        ret.value = [];
      }
      return ret;
    },
    createInputValue() {
      var type = this.lazyValue.type || "";
      if (type.indexOf("[]") == -1 && type !== "clippath") {
        return this.lazyValue;
      }

      var ret = cloneDeep(this.lazyValue);
      ret.value = JSON.stringify(ret.value.filter((id) => id));
      return ret;
    },
    save() {
      this.rpc().putSetting(this.lazyValue.key, this.createInputValue().value);
      this.onInput();
    },
    editZone() {
      this.editingZone = true;
    },
  },
};
</script>
<style scoped>
.shift-up {
  margin-top: -8px;
}
</style>