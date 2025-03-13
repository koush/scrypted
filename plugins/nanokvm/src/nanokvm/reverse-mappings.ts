import { modifierKeys, specialKeyMap } from "./virtual-keys";

export const fixedSpecialKeys = new Map<string, string>();
for (const [key, value] of specialKeyMap) {
    fixedSpecialKeys.set(value, value);
}

export const fixedModifierKeys = modifierKeys.map(key => specialKeyMap.get(key));
