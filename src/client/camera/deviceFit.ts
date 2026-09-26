export interface DeviceInputs {
  readonly userAgent: string;
  readonly coarsePointer: boolean;
  readonly touchPoints: number;
}

export type DeviceFit = "desktop" | "phone" | "in-app";

export function detectDeviceFit(input: DeviceInputs): DeviceFit {
  if (/LINE\/|Instagram|FBAN|FBAV|MicroMessenger/i.test(input.userAgent))
    return "in-app";
  if (
    !input.coarsePointer &&
    input.touchPoints === 0 &&
    !/Android|iPhone|iPad|iPod|Mobile/i.test(input.userAgent)
  )
    return "desktop";
  return "phone";
}
