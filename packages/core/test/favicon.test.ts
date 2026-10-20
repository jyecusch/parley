import { describe, expect, it } from "@effect/vitest"
import { isPublicAddress } from "../src/files/favicon.ts"

describe("logo fetching", () => {
  it("refuses private addresses, including IPv4 hidden in IPv6", () => {
    const cases: Record<string, boolean> = {
      "8.8.8.8": true,
      "10.0.0.1": false,
      "127.0.0.1": false,
      "169.254.169.254": false,
      "2606:4700::1111": true,
      "::1": false,
      "::": false,
      "::ffff:127.0.0.1": false,
      "::ffff:7f00:1": false,
      "::127.0.0.1": false,
      "64:ff9b::10.0.0.1": false,
      "64:ff9b::8.8.8.8": true,
      "2002:7f00:1::": false,
      "2002:0808:0808::": true,
      "fec0::1": false,
      "fe80::1": false,
      "fd00::1": false,
      "ff02::1": false,
      "2001:db8::1": false,
      "not an address": false,
    }
    for (const [address, expected] of Object.entries(cases)) expect(isPublicAddress(address), address).toBe(expected)
  })
})
