<template>
  <div>
    <Javascript showSave="true" @save="$emit('save')" @input="onChange" v-model="data" :testDevice="testDevice"> </Javascript>
  </div>
</template>
<script>
import Javascript from "../../interfaces/automation/Javascript.vue";

export default {
  components: {
    Javascript,
  },
  computed: {
    testDevice() {
      return this.$scrypted.systemManager.getDeviceById(this.id);
    },
  },
  props: ["value", "id"],
  data() {
    let data;
    try {
      data = JSON.parse(this.value);
    } catch (e) {
      data = {
        script: "",
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
