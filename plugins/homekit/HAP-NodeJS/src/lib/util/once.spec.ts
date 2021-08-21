import { once } from './once';

describe('#once()', () => {
  it('should call a function once', () => {
    const spy = jest.fn();
    const callback = once(spy);
    callback();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should throw an error if a function is called more than once', () => {
    const spy = jest.fn();
    const callback = once(spy);
    callback();

    expect(() => {
      callback();
    }).toThrow(' already been called');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
