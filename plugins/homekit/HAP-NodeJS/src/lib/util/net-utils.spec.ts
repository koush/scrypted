import { findLoopbackAddress } from "./net-utils";
import os from "os";

const mock = jest.spyOn(os, "networkInterfaces");

describe("net-utils", () => {
  describe(findLoopbackAddress, () => {
    it("should find ipv4 only loopback address", () => {
      mock.mockImplementationOnce(() => ({
        "lo": [{
          address: "127.0.0.1",
          netmask: "255.0.0.0",
          family: "IPv4",
          mac: "00:00:00:00:00:00",
          internal: true,
          cidr: "127.0.0.1/8",
        }],
        "eth0": [{
          address: "192.168.0.3",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:03:04:00:02",
          internal: false,
          cidr: "192.168.0.3/24",
        }],
      }));

      expect(findLoopbackAddress()).toBe("127.0.0.1");
    });

    it("should properly format ipv6 link local loopback address", () => {
      mock.mockImplementationOnce(() => ({
        "lo": [
          {
            address: "fe80::1",
            netmask: 'ffff:ffff:ffff:ffff::',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: 'fe80::1/64',
            scopeid: 1
          },
        ],
      }));

      expect(findLoopbackAddress()).toBe("fe80::1%lo");
    });

    it("should prioritize ipv6 loopback address", () => {
      mock.mockImplementationOnce(() => ({
        "lo": [
          {
            address: '::1',
            netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '::1/128',
            scopeid: 0
          },
          {
            address: "fe80::1",
            netmask: 'ffff:ffff:ffff:ffff::',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: 'fe80::1/64',
            scopeid: 1
          },
        ],
      }));

      expect(findLoopbackAddress()).toBe("::1");
    });

    it("should prioritize ipv4 loopback address", () => {
      mock.mockImplementationOnce(() => ({
        "lo": [
          {
            address: "127.0.0.1",
            netmask: "255.0.0.0",
            family: "IPv4",
            mac: "00:00:00:00:00:00",
            internal: true,
            cidr: "127.0.0.1/8",
          },
          {
            address: "fe80::1",
            netmask: 'ffff:ffff:ffff:ffff::',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: 'fe80::1/64',
            scopeid: 1
          },
          {
            address: '::1',
            netmask: 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff',
            family: 'IPv6',
            mac: '00:00:00:00:00:00',
            internal: true,
            cidr: '::1/128',
            scopeid: 0
          },
        ],
      }));

      expect(findLoopbackAddress()).toBe("127.0.0.1");
    });

    it("should throw an error if it can't find one", () => {
      mock.mockImplementationOnce(() => ({
        "eth0": [{
          address: "192.168.0.3",
          netmask: "255.255.255.0",
          family: "IPv4",
          mac: "00:00:03:04:00:02",
          internal: false,
          cidr: "192.168.0.3/24",
        }],
      }));

      expect(() => findLoopbackAddress()).toThrowError();
    });
  });
});
