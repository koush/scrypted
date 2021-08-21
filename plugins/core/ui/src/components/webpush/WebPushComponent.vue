<script>
import BasicComponent from "../BasicComponent.vue";
import WebPushSubscribe from "./WebPushSubscribe.vue";
import WebPushInvite from "./WebPushInvite.vue";
import axios from "axios";
import qs from "query-string";
import { getComponentWebPath } from "../helpers";

export default {
  mixins: [BasicComponent],
  data() {
    const componentWebPath = getComponentWebPath("webpush");

    const invite = {};
    const inviteCard = {
      body: WebPushInvite,
      hide: true,
      buttons: [
        {
          click(invite) {
            window.open(invite.invite, "scrypted-invite");
          },
          title: "Notify This Device"
        }
      ],
      description:
        "The invite link will expire in 10 minutes. Copy the link and invite a different user or device, or subscribe on this browser.",
      title: "Browser Push Invite Link",
      value: invite
    };

    return {
      cards: [
        {
          body: WebPushSubscribe,
          buttons: [
            {
              click(value) {
                axios
                  .post(`${componentWebPath}/invite`, qs.stringify(value))
                  .then(response => {
                    Object.assign(invite, response.data);
                    inviteCard.hide = false;
                    invite.name = value.name;
                  });
              },
              title: "Invite"
            }
          ],
          description: "Notifications for Chrome on Desktop and Android.",
          title: "Browser Push Notifications",
          value: {
            name: ""
          }
        },
        inviteCard
      ],
      resettable: false,
      component: {
        icon: "bell",
        id: "webpush",
        name: "Subscribed Browsers"
      }
    };
  }
};
</script>