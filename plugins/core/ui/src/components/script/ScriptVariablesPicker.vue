<template>
  <Grower
    v-model="lazyValue"
    :empty="unassigned"
    @input="onInput"
    addButton="Add Variable"
  >
    <template v-slot:default="slotProps">
      <ScriptVariablePicker
        :actions="actions"
        :scriptType="scriptType"
        v-model="slotProps.item"
        @input="slotProps.onInput"
      ></ScriptVariablePicker>
    </template>
  </Grower>
</template>

<script>
import ScriptVariablePicker from "./ScriptVariablePicker.vue";
import CustomValue from "../../common/CustomValue.vue";
import Grower from "../../common/Grower.vue";

export default {
  props: ["actions", "scriptType"],
  mixins: [CustomValue],
  components: {
    Grower,
    ScriptVariablePicker
  },
  computed: {
    unassigned() {
      return {
        key: "",
        value: "unassigned"
      };
    }
  }
};
</script>
