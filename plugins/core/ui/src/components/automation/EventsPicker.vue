<template>
  <Grower v-model="lazyValue" :empty="unassigned" @input="onInput">
    <template v-slot:default="slotProps">
      <EventPicker
        :events="events"
        :interfaces="interfaces"
        v-model="slotProps.item"
        @input="slotProps.onInput"
      ></EventPicker>
    </template>
  </Grower>
</template>

<script>
import EventPicker from "./EventPicker.vue";
import CustomValue from "../../common/CustomValue.vue";
import Grower from "../../common/Grower.vue";

export default {
  props: {
    name: String,
    events: Array,
    interfaces: Array
  },
  mixins: [CustomValue],
  components: {
    Grower,
    EventPicker
  },
  methods: {
    createInputValue() {
      return this.lazyValue.slice().filter(e => e.id != "unassigned");
    }
  },
  computed: {
    componentProps() {
      return {
        events: this.events,
        interfaces: this.interfaces
      };
    },
    unassigned() {
      return {
        id: "unassigned",
        condition: null,
        model: {}
      };
    }
  }
};
</script>
