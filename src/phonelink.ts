// The link of the phone page (ticket i-need-an-iphone-app-with-just-overview), for the code in
// Options. No imports and no access to the page, so a test can load this file with Node.

/**
 * The address of the phone page: the first address of the host that another device can reach, with
 * the phone key after `#`, so the first request of the code holds no key. The page then moves the key
 * into its query, so its later requests hold it. `addresses` are the `<ip>:<port>` texts of
 * `host.json`. Null without a key or without such an address.
 */
export function phoneLink(addresses: readonly string[], key: string | null | undefined): string | null {
  if (!key) return null;
  const address = addresses.find((one) => one !== "" && !one.startsWith("127."));
  return address ? `http://${address}/#key=${key}` : null;
}

/** What the Phone tab of Options shows: the next step, and the link once a code can show. */
export interface PhoneSetup {
  step: "start" | "tailscale" | "connect" | "pin" | "scan";
  link: string | null;
}

/**
 * The step of the phone setup: `start` with the host off, `tailscale` when the host has no address
 * for the phone, `connect` when this window does not use the host (the phone then lists no project of
 * it), `pin` while no PIN is set (ticket a-pin-unlocks-the-phone-page: the phone shows nothing without
 * it; the code shows already), and `scan` when all is ready.
 */
export function phoneSetup(running: boolean, addresses: readonly string[], key: string | null | undefined, windowUsesHost: boolean, pinSet: boolean): PhoneSetup {
  if (!running) return { step: "start", link: null };
  const link = phoneLink(addresses, key);
  if (!link) return { step: "tailscale", link: null };
  return { step: !windowUsesHost ? "connect" : !pinSet ? "pin" : "scan", link };
}

/** The rule of a PIN of the phone: at least 6 digits, nothing else. The host checks the same rule. */
export function phonePinOk(pin: string): boolean {
  return /^\d{6,}$/.test(pin);
}
