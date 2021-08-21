// @ts-ignore
import storage, { LocalStorage } from "node-persist";

export class HAPStorage {

  private static readonly INSTANCE = new HAPStorage();

  private localStore?: LocalStorage;
  private customStoragePath?: string;

  public static storage(): LocalStorage {
    return this.INSTANCE.storage();
  }

  public static setCustomStoragePath(path: string): void {
    this.INSTANCE.setCustomStoragePath(path);
  }

  public storage(): LocalStorage {
    if (!this.localStore) {
      this.localStore = storage.create();

      if (this.customStoragePath) {
        this.localStore.initSync({
          dir: this.customStoragePath,
        })
      } else {
        this.localStore.initSync();
      }
    }

    return this.localStore;
  }

  public setCustomStoragePath(path: string): void {
    if (this.localStore) {
      throw new Error("Cannot change storage path after it has already been initialized!");
    }

    this.customStoragePath = path;
  }

}
