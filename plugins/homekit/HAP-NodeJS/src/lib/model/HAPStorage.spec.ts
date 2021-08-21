// @ts-ignore
import nodePersist from "node-persist";
import { HAPStorage } from "./HAPStorage";

describe(HAPStorage, () => {

  describe("storage", () => {
    it('should init storage correctly and only once', function () {
      const storage = new HAPStorage();

      // @ts-ignore
      expect(storage.localStore).toBeUndefined();
      const localStore = storage.storage(); // init first time
      expect(nodePersist.create).toHaveBeenCalledTimes(1);
      expect(localStore.initSync).toHaveBeenCalledTimes(1);

      // @ts-ignore
      expect(storage.localStore).toBeDefined();
      const localStore2 = storage.storage(); // init first time
      expect(nodePersist.create).toHaveBeenCalledTimes(1);
      expect(localStore2).toEqual(localStore);
      expect(localStore2.initSync).toHaveBeenCalledTimes(1);
    });

  });

  describe("setCustomStoragePath", () => {
    it('should init storage correctly with custom storage path', function () {
      const storage = new HAPStorage();

      storage.setCustomStoragePath("asdfPath");
      const localStore = storage.storage();
      expect(localStore.initSync).toHaveBeenCalledTimes(1);
      expect(localStore.initSync).toHaveBeenLastCalledWith({dir: "asdfPath"});
    });

    it('should reject setCustomStoragePath after storage has already been initialized', function () {
      const storage = new HAPStorage();

      storage.storage();
      expect(() => storage.setCustomStoragePath("customPath")).toThrow(Error);
    });
  })

});
