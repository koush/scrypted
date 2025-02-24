import { OnOff, Readme, ScryptedDeviceBase } from "@scrypted/sdk";
import type { HikvisionCamera } from "./main";

export class HikvisionAlarmSwitch extends ScryptedDeviceBase implements OnOff, Readme {
    on: boolean = false;

    constructor(public camera: HikvisionCamera, nativeId: string) {
        super(nativeId);
        this.on = false;
    }

    async turnOn() {
        this.on = true;
        await this.setAlarm(true);
    }

    async turnOff() {
        this.on = false;
        await this.setAlarm(false);
    }
    
    private async setAlarm(state: boolean): Promise<void> {
        const api = this.camera.getClient();
        await api.setAlarm(state);
    }

    async getReadmeMarkdown(): Promise<string> {
        return `
## **Alarm Switch**
This switch triggers the camera's alarm input.  

### **Enabling Alarm Linkages**
To link the alarm to the camera's equipped features like strobe light, or audio alarm:  

1. Log in to the camera’s web interface.  
2. Go to *Configuration > Event > Event and Detection (or Basic Event)*.  
3. Select Alarm Input.  
4. Edit under Operation(pencil icon) (or Linkage Method).
4. Set Linkage Actions  
   - Audible Warning (siren)  
   - Alarm (strobe light)

When the alarm is switched on, the linkages will activate. 

### **Strobe Light and Audio Alarm Settings**
To configure the strobe light and audio alarm:

1. Log in to the camera’s web interface.
2. Navigate to *Configuration > Event > Alarm Setting (or Basic Event)*. 
3. **For Strobe Light**: 
   - Select 'Flashing Alarm Light Output'.

   **For Audio Alarm**:
    - Select 'Audible Alarm Output'.
        `;
    }
}