import { KeyboardCodes, ModifierCodes } from "./mappings";
import { fixedModifierKeys as modifierKeys, fixedSpecialKeys as specialKeyMap } from "./reverse-mappings";
import { WebSocket } from "ws";

export class VirtualKeyboard {
    activeModifierKeys: string[] = [];

    constructor(public console: Console, public client: WebSocket) {
    }

    clientSend(data: number[]) {
        this.client.send(JSON.stringify(data));
    }

    setActiveModifierKeys(keys: string[]) {
        this.activeModifierKeys = keys;
    }

    onKeyPress(key: string) {
        if (modifierKeys.includes(key)) {
            this.setActiveModifierKeys(this.activeModifierKeys.filter((activeKey) => activeKey !== key));
            this.setActiveModifierKeys([...this.activeModifierKeys, key]);
            return;
        }

        this.sendKeydown(key);
    }

    onKeyReleased(key: string) {
        if (modifierKeys.includes(key)) {
            this.setActiveModifierKeys(this.activeModifierKeys.filter((activeKey) => activeKey !== key));
            this.sendModifierKeyUp();
            return;
        }

        this.sendKeyup();
    }

    sendKeydown(key: string) {
        const specialKey = specialKeyMap.get(key);
        const code = KeyboardCodes.get(specialKey ? specialKey : key);
        if (!code) {
            this.console.log('unknown code: ', key);
            return;
        }

        // key ups and downs are sent with active modifiers per key
        const modifiers = this.sendModifierKeyDown();
        this.clientSend([1, code, ...modifiers]);
    }

    sendKeyup() {
        // key ups and downs are sent with active modifiers per key
        this.sendModifierKeyUp();
        this.clientSend([1, 0, 0, 0, 0, 0]);
    }

    sendModifierKeyDown() {
        let ctrl = 0;
        let shift = 0;
        let alt = 0;
        let meta = 0;

        this.activeModifierKeys.forEach((modifierKey) => {
            const key = specialKeyMap.get(modifierKey)!;

            const code = KeyboardCodes.get(key)!;
            const modifier = ModifierCodes.get(key)!;

            if ([1, 16].includes(modifier)) {
                ctrl = modifier;
            } else if ([2, 32].includes(modifier)) {
                shift = modifier;
            } else if ([4, 64].includes(modifier)) {
                alt = modifier;
            } else if ([8, 128].includes(modifier)) {
                meta = modifier;
            }

            this.clientSend([1, code, ctrl, shift, alt, meta]);
        });

        return [ctrl, shift, alt, meta];
    }

    sendModifierKeyUp() {
        if (this.activeModifierKeys.length === 0) return;

        this.activeModifierKeys.forEach(() => {
            this.clientSend([1, 0, 0, 0, 0, 0]);
        });
    }
}
