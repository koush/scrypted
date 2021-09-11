<template>
  <v-container>
    <v-layout>
      <v-flex>
        <Grower
          addButton="Add Password"
          v-model="passwords"
          :empty="{ key: '', value: '' }"
          @input="onInput"
        >
          <template v-slot:default="slotProps">
            <PasswordEntry
              :device="device"
              v-model="slotProps.item"
              @input="slotProps.onInput"
            ></PasswordEntry>
          </template>
        </Grower>
      </v-flex>
    </v-layout>
  </v-container>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
import Grower from "../common/Grower.vue";
import PasswordEntry from "./PasswordEntry.vue";

export default {
  mixins: [RPCInterface],
  components: {
    Grower,
    PasswordEntry,
  },
  data() {
    return {
      passwords: [],
    };
  },
  watch: {
    value() {
      this.refresh();
    },
  },
  methods: {
    async refresh() {
      this.passwords = (await this.rpc().getPasswords()).map(
        (password, index) => ({
          key: index,
          value: password,
        })
      );
    },
  },
  mounted() {
    this.refresh();
  },
  onChange() {},
};
</script>