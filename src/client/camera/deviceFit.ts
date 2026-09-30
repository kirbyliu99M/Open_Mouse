export interface DeviceInputs {
  readonly userAgent: string;
  readonly coarsePointer: boolean;
}

export type DeviceFit = "desktop" | "phone" | "in-app";

// UA tokens are best-effort: apps and browser versions can change them.
const IN_APP_UA =
  /Line\/\d+|Instagram|FBAN|FBAV|MicroMessenger|BytedanceWebview|musical_ly|Barcelona|KAKAOTALK/i;
const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/i;

export function detectDeviceFit(input: DeviceInputs): DeviceFit {
  if (IN_APP_UA.test(input.userAgent)) return "in-app";
  if (input.coarsePointer || MOBILE_UA.test(input.userAgent)) return "phone";
  return "desktop";
}
