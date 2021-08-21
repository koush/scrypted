<template>
  <Select2 v-model="lazyValue.selected" :options="videoInterfaces" @input="onChange"></Select2>
</template>
<script>
import RPCInterface from "../RPCInterface.vue";
import Select2 from "../../common/Select2.vue";
import cloneDeep from "lodash.clonedeep";

function unassigned() {
  return {
    id: "unassigned",
    text: "Select VideoCamera",
    component: "Unassigned",
    model: {}
  };
}

export default {
  mixins: [RPCInterface],
  components: {
      Select2,
  },
  props: {
    events: Array,
    interfaces: Array
  },
  computed: {
    videoInterfaces: function() {
      return this.interfaces.filter(iface => iface.component === "VideoCamera");
    }
  },
  methods: {
    createLazyValue() {
      let selected =
        (!this.value.id || this.value.id === "unassigned")
          ? unassigned()
          : this.interfaces.find(e => e.id === this.value.id);
      selected = cloneDeep(selected);
      return {
        selected,
        model: cloneDeep(this.value.model)
      };
    },
    createInputValue() {
      return {
        id: this.lazyValue.selected.id,
        model: this.lazyValue.model,
        rpc: this.lazyValue.rpc,
      }
    },
    onChange() {
      this.rpc().detectFaces(this.lazyValue.selected.id);
    }
  }
};
</script>