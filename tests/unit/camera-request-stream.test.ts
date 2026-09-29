import { expect, it, vi } from "vitest";
import { requestCameraStream } from "../../src/client/camera/requestStream";

it("stops every track when getUserMedia resolves after the camera unmounts", async () => {
  let resolveStream!: (stream: MediaStream) => void;
  const pending = new Promise<MediaStream>((resolve) => {
    resolveStream = resolve;
  });
  const mediaDevices = {
    getUserMedia: vi.fn(() => pending),
  } as unknown as MediaDevices;
  const stopVideo = vi.fn();
  const stopAudio = vi.fn();
  const stream = {
    getTracks: () => [{ stop: stopVideo }, { stop: stopAudio }],
  } as unknown as MediaStream;
  let mounted = true;
  const request = requestCameraStream(
    mediaDevices,
    { video: true },
    () => mounted,
  );
  mounted = false;
  resolveStream(stream);
  await expect(request).resolves.toBeNull();
  expect(stopVideo).toHaveBeenCalledOnce();
  expect(stopAudio).toHaveBeenCalledOnce();
});
