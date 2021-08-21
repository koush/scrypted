<script>
import BasicComponent from "../BasicComponent.vue";
import { getComponentViewPath } from "../helpers";

export default {
  mixins: [BasicComponent],
  mounted() {
    this.refresh();
  },
  computed: {
    cards() {
      const self = this;
      if (this.settings.loginEmail) {
        return [
          {
            buttons: [
              {
                title: "New Mail Endpoint",
                value: "mail",
                click() {
                  self.newDevice();
                }
              }
            ],
            description:
              `Forward emails From: ${this.settings.loginEmail} to receive events.`,
            title: "Add New Mail Endpoint"
          }
        ];
      } else {
        return [
          {
            buttons: [
              {
                title: "Remote Mangement",
                click() {
                  self.$router.push(getComponentViewPath("remote"));
                }
              }
            ],
            description:
              "Your must enable Remote Management to receive emails.",
            title: "Enable Remote Management"
          }
        ];
      }
    }
  },
  data() {
    return {
      component: {
        icon: "mail",
        id: "mail",
        name: "Incoming Mail"
      }
    };
  }
};
</script>