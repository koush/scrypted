<template>
  <v-text-field
    autocomplete="off"
    outlined
    solo
    flat
    v-model="lazyValue.value"
    persistent-hint
    :type="showPassword ? undefined : 'password'"
  >
    <template v-slot:append>
      <v-btn v-if="dirty" outlined text color="green" dark tile @click="save">
        <font-awesome-icon size="lg" icon="check" />
      </v-btn>
      <v-btn outlined text color="blue" dark tile @click="showPassword = !showPassword">
        <font-awesome-icon size="lg" icon="eye-slash" />
      </v-btn>
      <v-btn
        v-if="value.value && confirmTrash"
        outlined
        text
        color="red"
        dark
        tile
        @click="confirmTrash = false"
      >
        <font-awesome-icon size="lg" icon="ban" />
      </v-btn>
      <v-btn v-if="value.value" outlined text color="red" dark tile @click="remove">
        <font-awesome-icon size="lg" icon="trash" />
      </v-btn>
    </template>
  </v-text-field>
</template>
<script>
import RPCInterface from "./RPCInterface.vue";
export default {
  mixins: [RPCInterface],
  data() {
    return {
      showPassword: false,
      confirmTrash: false
    };
  },
  computed: {
    dirty() {
      return this.lazyValue.value !== this.value.value;
    }
  },
  methods: {
    async save() {
      await this.rpc().removePassword(this.value.value);
      await this.rpc().addPassword(this.lazyValue.value);
      this.onInput();
    },
    async remove() {
      if (!this.confirmTrash) {
        this.confirmTrash = true;
        return;
      }
      await this.rpc().removePassword(this.value.value);
      this.lazyValue.value = '';
      this.onInput();
    }
  }
};
</script>