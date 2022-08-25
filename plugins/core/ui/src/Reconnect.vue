<template>
    <v-dialog :value="true" persistent max-width="600px">
        <v-card dark color="purple">
            <v-card-title>
                <span class="headline">Scrypted Management Console</span>
            </v-card-title>
            <v-card-text></v-card-text>
            <v-card-actions>
                <v-spacer></v-spacer>
                <v-btn text @click="reconnect">Reconnect</v-btn>
            </v-card-actions>
        </v-card>
    </v-dialog>
</template>
    <script>
    export default {
        methods: {
            reconnect() {
                this.$connectScrypted().catch((e) => (this.loginResult = e.toString()));
            },
        }
    }
    </script>