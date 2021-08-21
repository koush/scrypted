import { AccessoryInfo } from "./AccessoryInfo";
import { AssertionError } from "assert";

describe('AccessoryInfo', () => {
    describe('#assertValidUsername()', () => {
        it('should verify correct device id', function () {
            const VALUE = "0E:AE:FC:45:7B:91";
            expect(() => AccessoryInfo.assertValidUsername(VALUE)).not.toThrow(AssertionError);
        });

        it('should fail to verify too long device id', function () {
            const VALUE = "00:2c:44:f9:30:8f:d1:2e";
            expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError);
        });

        it('should fail to verify too short device id', function () {
            const VALUE = "00:2c:d1:2e";
            expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError);
        });

        it('should fail to verify device id containing invalid characters', function () {
            const VALUE = "0E:AG:FC:45:7B:91";
            expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError);
        });

        it('should fail to verify undefined device id', function () {
            const VALUE = undefined;
            // @ts-ignore
            expect(() => AccessoryInfo.assertValidUsername(VALUE)).toThrow(AssertionError);
        });
    });
});
