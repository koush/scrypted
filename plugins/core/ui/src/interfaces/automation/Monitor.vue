<template>
    <div class="card">
        <div class="card-body">
            <div class="form-group">
                <label class="form-label">Watch for Condition</label>
                <input v-model='value.condition' class="form-control" placeholder="OnOff example: eventData === true" @input='onChange'/>
            </div>
            <div class="form-group">
                <label>Monitor Duration (seconds):</label>
                <input ref="seconds" type="number" class="form-control-range" v-model="value.seconds" :min="0" :max="86400" @change="onChange">
            </div>
        </div>
    </div>
</template>

<script>
import RPCInterface from '../RPCInterface.vue'

export default {
    mixins: [RPCInterface],
    mounted: function() {
        $(this.$refs.seconds).inputSpinner({
            groupClass: "input-group-sm"
        });
    },
    methods: {
        onChange: function() {
            this.rpc({
                varargs: true,
            }).watch(this.value.condition, parseInt(this.value.seconds * 1000));
        },
    }
};
</script>
