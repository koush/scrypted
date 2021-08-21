<template>
  <div class="form-group row">
    <a :href="`https://developer.scrypted.app/#${name.toLowerCase()}`" target="developer">{{ name }}</a>
    <Select2
      v-model="lazyValue"
      :options="mappedInterfaces"
      :multiple="true"
      @input="onInput"
    ></Select2>
  </div>
</template>
<script>
import Select2 from "../../common/Select2.vue"
import CustomValue from "../../common/CustomValue.vue";

export default {
  props: {
    name: String,
    value: Array,
  },
  mixins: [CustomValue],
  components: {
    Select2
  },
  methods: {
    createLazyValue() {
      var mapped = this.mapThem();
      return this.value
        .map(iface => mapped.find(e => e.id == iface))
        .filter(e => e != null);
    },
    createInputValue() {
      return this.lazyValue.map(iface => iface.id);
    },
    mapThem: function() {
      const ret = [];
      for (const id of Object.keys(
        this.$scrypted.systemManager.getSystemState()
      )) { 
        const device = this.$scrypted.systemManager.getDeviceById(id);
        ret.push(device.interfaces.map(iface => ({
          id: `${device.id}#${iface}`,
          text: `${device.name} (${iface})`,
        })))
      }

      return ret.flat();
    }
  },
  computed: {
    mappedInterfaces: {
      get: function() {
        return this.mapThem();
      }
    }
  }
};
</script>