import { HAPStatus } from '../HAPServer';
import { HapStatusError } from './hapStatusError';

describe('HapStatusError', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it("sets the hap status code correctly", async () => {
    const error = new HapStatusError(HAPStatus.RESOURCE_BUSY);
    expect(error.hapStatus).toEqual(HAPStatus.RESOURCE_BUSY);
  });

  it("reverts to SERVICE_COMMUNICATION_FAILURE if an invalid code is passed in", async () => {
    const error = new HapStatusError(23452352352323423423);
    expect(error.hapStatus).toEqual(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  });

});