import { CiaoAdvertiser, PairingFeatureFlag, StatusFlag } from './Advertiser';

describe(CiaoAdvertiser, () => {
  describe("ff and sf", () => {
    it('should correctly format pairing feature flags', function () {
      expect(CiaoAdvertiser.ff()).toEqual(0);
      expect(CiaoAdvertiser.ff(PairingFeatureFlag.SUPPORTS_HARDWARE_AUTHENTICATION)).toEqual(1);
      expect(CiaoAdvertiser.ff(PairingFeatureFlag.SUPPORTS_SOFTWARE_AUTHENTICATION)).toEqual(2);
      expect(CiaoAdvertiser.ff(
        PairingFeatureFlag.SUPPORTS_HARDWARE_AUTHENTICATION,
        PairingFeatureFlag.SUPPORTS_SOFTWARE_AUTHENTICATION,
      )).toEqual(3);
    });

    it('should correctly format status flags', function () {
      expect(CiaoAdvertiser.sf()).toEqual(0);

      expect(CiaoAdvertiser.sf(StatusFlag.NOT_PAIRED)).toEqual(1);
      expect(CiaoAdvertiser.sf(StatusFlag.NOT_JOINED_WIFI)).toEqual(2);
      expect(CiaoAdvertiser.sf(StatusFlag.PROBLEM_DETECTED)).toEqual(4);

      expect(CiaoAdvertiser.sf(StatusFlag.NOT_PAIRED, StatusFlag.NOT_JOINED_WIFI)).toEqual(3);
      expect(CiaoAdvertiser.sf(StatusFlag.NOT_PAIRED, StatusFlag.PROBLEM_DETECTED)).toEqual(5);
      expect(CiaoAdvertiser.sf(StatusFlag.NOT_JOINED_WIFI, StatusFlag.PROBLEM_DETECTED)).toEqual(6);

      expect(CiaoAdvertiser.sf(StatusFlag.NOT_PAIRED, StatusFlag.NOT_JOINED_WIFI, StatusFlag.PROBLEM_DETECTED)).toEqual(7);
    });
  });
})
