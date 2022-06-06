<script>
import { getDeviceAvailableMixins, setMixin } from "../common/mixin";
import { getDeviceViewPath } from './helpers';

export default {
  methods: {
    async toggleMixin(mixin) {
      await setMixin(
        this.$scrypted.systemManager,
        this.device,
        mixin.id,
        mixin.enabled
      );
    },
    openDevice(id) {
      this.$router.push(getDeviceViewPath(id));
    },
  },
  asyncComputed: {
    availableMixins: {
      async get() {
        const mixins = this.device.mixins || [];
        const availableMixins = (
          await getDeviceAvailableMixins(
            this.$scrypted.systemManager,
            this.device
          )
        ).filter((device) => !mixins.includes(device.id));

        const allMixins = [
          ...mixins
            .map((id) => this.$scrypted.systemManager.getDeviceById(id))
            .filter((device) => !!device),
          ...availableMixins,
        ];

        const ret = allMixins.map((provider) => ({
          id: provider.id,
          name: provider.name,
          enabled: mixins.includes(provider.id),
        }));

        return ret;
      },
      watch: ["id"],
      default: [],
    },
  },
};
</script>
