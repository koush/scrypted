import { MailService } from '@sendgrid/mail';

import { MediaObject, Notifier, Settings, ScryptedDeviceBase, Setting, SettingValue } from '@scrypted/sdk';
import sdk from '@scrypted/sdk';

const { mediaManager } = sdk;

class SendGridProvider extends ScryptedDeviceBase implements Notifier, Settings {
    sendgridClient: MailService

    constructor(nativeId?: string) {
        super(nativeId);
        this.initializeSendGrid();
    }

    to(): string {
        return this.storage.getItem('to')
    }

    from(): string {
        return this.storage.getItem('from')
    }

    apikey(): string {
        return this.storage.getItem('apikey')
    }

    initializeSendGrid(): void {
        const to = this.to();
        const from = this.from();
        const apikey = this.apikey();

        if (!to || !from || !apikey) {
            this.sendgridClient = null;
            return
        }

        if (this.sendgridClient) {
            return
        }

        this.sendgridClient = new MailService();
        this.sendgridClient.setApiKey(apikey);
        this.console.info('Initialized new SendGrid client')
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                title: 'To',
                key: 'to',
                description: 'Recipient of emails created by this plugin.',
                value: this.storage.getItem('to')
            },
            {
                title: 'From',
                key: 'from',
                description: 'Sender address for of emails created by this plugin. Must be a verified sender in your Twilio SendGrid account.',
                value: this.storage.getItem('from')
            },
            {
                title: 'SendGrid API Key',
                key: 'apikey',
                value: this.storage.getItem('apikey')
            }
        ]
    }

    async putSetting(key: string, value: SettingValue): Promise<void> {
        this.storage.setItem(key, '' + value);
        this.initializeSendGrid();
    }

	async sendNotification(title: string, body: string, media?: string | MediaObject): Promise<void> {
        if (!this.sendgridClient) {
            this.console.warn('SendGrid client not initialized, cannot send notification')
            return;
        }

        let attachments = [];
		if (typeof media === 'string') {
			media = await mediaManager.createMediaObjectFromUrl(media as string);
        }
		if (media) {
			let data: Buffer = await mediaManager.convertMediaObjectToBuffer(media as MediaObject, 'image/png');
            let b64PictureData: string = data.toString('base64');
            attachments = [
                {
                    content: b64PictureData,
                    filename: 'snapshot.png',
                    type: 'image/png',
                    disposition: 'attachment'
                }
            ]
        }

        let msg = {
            to: this.to(),
            from: this.from(),
            subject: title,
            html: body,
            attachments: attachments 
        }

        await this.sendgridClient.send(msg);
        this.console.info(`Email sent to ${this.to()}`)
	}
};

const provider = new SendGridProvider();

export default provider;
