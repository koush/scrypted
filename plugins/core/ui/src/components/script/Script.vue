<template>
  <div>
    <Scriptable @input="onChange" v-model="data" :device="device"> </Scriptable>
  </div>
</template>
<script>
import Scriptable from "../../interfaces/automation/Scriptable.vue";

export default {
  components: {
    Scriptable,
  },
  computed: {
    device() {
      return this.$scrypted.systemManager.getDeviceById(this.id);
    },
  },
  props: ["value", "id"],
  data() {
    let data;
    try {
      data = JSON.parse(this.value);
      if (!data['script.ts'])
        throw new Error();
    } catch (e) {
      data = {
        'script.ts': "",
      };
    }

    return {
      data,
    };
  },
  methods: {
    onChange() {
      this.$emit("input", JSON.stringify(this.data));
    },
  },
};
</script>
