import type { Connectivity } from "../../lib/contracts/descriptors";

/**
 * The current Logitech lineup (M1 option C). Every dimension is read from the
 * manufacturer's own product page — no third-party source. Model names follow
 * common product naming so they can be matched in rubric validation.
 */
export const LOGITECH_SOURCES: ReadonlyArray<{
  model: string;
  url: string;
  connectivity: Connectivity;
}> = [
  ...(
    [
      ["G Pro X Superlight 2", "pro-x2-superlight-wireless-mouse", "wireless"],
      ["G Pro X Superlight 2 DEX", "pro-x-superlight-2-dex", "wireless"],
      ["G Pro X Superlight 2c", "pro-x-superlight-2c", "wireless"],
      ["G Pro X Superlight 2 SE", "pro-x-superlight-2-se", "wireless"],
      ["G Pro 2 Lightspeed", "pro-2-lightspeed", "wireless"],
      ["G502 X", "g502-x-wired-lightforce", "wired"],
      ["G502 X Lightspeed", "g502-x-wireless-lightforce", "wireless"],
      ["G502 X Plus", "g502-x-plus-wireless-lightforce", "wireless"],
      ["G502 Hero", "g502-hero-gaming-mouse", "wired"],
      ["G309", "g309-lightspeed-gaming-mouse", "wireless"],
      ["G305 Lightspeed", "g305-lightspeed-wireless-gaming-mouse", "wireless"],
      ["G203 Lightsync", "g203-lightsync-rgb-gaming-mouse", "wired"],
      ["G403 Hero", "g403-hero-gaming-mouse", "wired"],
      ["G703 Lightspeed", "g703-hero-wireless-gaming-mouse", "wireless"],
      ["G903 Hero", "g903-hero-wireless-gaming-mouse", "wireless"],
    ] as const
  ).map(([model, path, connectivity]) => ({
    model,
    url: `https://www.logitechg.com/en-us/shop/p/${path}`,
    connectivity,
  })),
  ...(
    [
      ["MX Master 4", "mx-master-4", "wireless"],
      ["MX Master 3S", "mx-master-3s", "wireless"],
      ["MX Anywhere 3S", "mx-anywhere-3s", "wireless"],
      ["MX Vertical", "mx-vertical-ergonomic-mouse", "wireless"],
      ["Lift Vertical", "lift-vertical-ergonomic-mouse", "wireless"],
      ["ERGO M575", "m575-ergo-wireless-trackball", "wireless"],
      ["POP Mouse", "pop-wireless-mouse", "wireless"],
      ["Pebble 2 M350s", "pebble-2-m350s-wireless-mouse", "wireless"],
      ["M196", "m196-bluetooth-mouse", "wireless"],
      ["M240", "m240-silent-bluetooth-mouse", "wireless"],
      ["M650", "m650-signature-wireless-mouse", "wireless"],
      ["M720 Triathlon", "m720-triathlon", "wireless"],
      ["M550", "m550-signature-wireless-mouse", "wireless"],
      ["M705 Marathon", "m705-wireless-mouse", "wireless"],
      ["M190", "m190-wireless-mouse", "wireless"],
      ["M100", "m100-usb-mouse", "wired"],
      ["M750", "m750-signature-plus-wireless-mouse", "wireless"],
      ["M325s", "m325s-wireless-mouse", "wireless"],
      ["Mobi Fold", "mobi-fold-mouse", "wireless"],
      [
        "Signature Comfort Plus M850L",
        "signature-comfort-plus-m850l",
        "wireless",
      ],
      ["Signature Comfort M840L", "signature-comfort-m840l", "wireless"],
      ["MX Ergo S", "mx-ergo-s-wireless-trackball-mouse", "wireless"],
      ["ERGO M575S", "ergo-m575s-wireless-trackball", "wireless"],
    ] as const
  ).map(([model, path, connectivity]) => ({
    model,
    url: `https://www.logitech.com/en-us/shop/p/${path}`,
    connectivity,
  })),
];
