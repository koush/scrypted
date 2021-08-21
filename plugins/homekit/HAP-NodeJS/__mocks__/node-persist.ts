class Storage {
  getItem = jest.fn();
  setItemSync = jest.fn();
  persistSync = jest.fn();
  removeItemSync = jest.fn();
  initSync = jest.fn();
  create = jest.fn().mockImplementation(() => new Storage());
}

export default new Storage();
