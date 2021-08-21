<script>
import CustomValue from "../common/CustomValue.vue";

export default {
  props: {
    device: undefined,
    value: Object,
    properties: Object
  },
  mixins: [CustomValue],
  mounted() {
    // call onChange to guarantee sane values.
    if (!this.device && !this.lazyValue.rpc) {
      this.onChange();
    }
  },
  methods: {
    rpc(options) {
      if (this.device) {
        return this.device;
      }

      options = options || {};
      const { varargs, append } = options;
      var vm = this;
      return new Proxy(
        {},
        {
          get: function(target, method) {
            return function() {
              var parameters = Array.prototype.slice.call(arguments);
              if (!vm.device) {
                if (append) {
                  vm.lazyValue.rpc.push({
                    method,
                    parameters,
                    varargs
                  });
                } else {
                  vm.lazyValue.rpc = {
                    method,
                    parameters,
                    varargs
                  };
                }
                vm.onInput();
                return;
              }
            };
          }
        }
      );
    }
  }
};
</script>