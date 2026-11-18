// The link of the phone page (ticket i-need-an-iphone-app-with-just-overview), for the code in
// Options. No imports and no access to the page, so a test can load this file with Node.

/**
 * The address of the phone page: the first address of the host that another device can reach, with
 * the phone key after `#`, so the key never goes to the host as part of the request. `addresses` are
 * the `<ip>:<port>` texts of `host.json`. Null without a key or without such an address.
 */
export function phoneLink(addresses: readonly string[], key: string | null | undefined): string | null {
  if (!key) return null;
  const address = addresses.find((one) => one !== "" && !one.startsWith("127."));
  return address ? `http://${address}/#key=${key}` : null;
}
