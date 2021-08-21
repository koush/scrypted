<script>
export default {
  methods: {
    createLazyValue() {
      return Object.entries(this.value).map(([key, value]) => ({
        key,
        value
      }));
    },
    createInputValue() {
      var ret = {};
      this.lazyValue.forEach(e => (ret[e.key] = e.value));
      return ret;
    }
  }
};
</script>