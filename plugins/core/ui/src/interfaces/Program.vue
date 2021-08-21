<template>
    <span>
          <v-btn text color="primary" @click="onClick">Login</v-btn>
        <v-btn v-if='device' text color="green" @click='run'>Run Program</v-btn>
    </span>
</template>

<script>
import RPCInterface from './RPCInterface.vue'

export default {
    mixins: [RPCInterface],
    methods: {
        onChange() {
            this.run();
        },
        run: function() {
            this.rpc({
                varargs: true,
            }).run();
        },
    }
};
</script>
