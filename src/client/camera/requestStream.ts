/** Reject a permission result that arrived after its camera session ended. */
export async function requestCameraStream(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  constraints: MediaStreamConstraints,
  shouldAccept: () => boolean,
): Promise<MediaStream | null> {
  const stream = await mediaDevices.getUserMedia(constraints);
  if (!shouldAccept()) {
    stream.getTracks().forEach((track) => track.stop());
    return null;
  }
  return stream;
}
