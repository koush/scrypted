<template>
  <Grower
    addButton="Add Storage Entry"
    v-model="lazyValue"
    :empty="{ key: '', value:''}"
    @input="onInput"
  >
    <template v-slot:default="slotProps">
      <StorageEntry v-model="slotProps.item" @input="slotProps.onInput"></StorageEntry>
    </template>
  </Grower>
</template>
<script>
import Grower from "./Grower.vue";
import StorageEntry from "./StorageEntry.vue";
import CustomValue from "./CustomValue.vue";
import ObjectToArrayValue from "./ObjectToArrayValue.vue";

export default {
  mixins: [CustomValue, ObjectToArrayValue],
  components: {
    Grower,
    StorageEntry,
  },
  computed: {
    StorageEntry() {
      return StorageEntry;
    }
  }
};
</script>