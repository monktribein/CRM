/**
 * Screen capture through the standard browser screen-sharing API. The browser
 * always shows its own permission prompt and "sharing" indicator; nothing here
 * bypasses or hides them. Audio is never requested.
 */

const MAX_WIDTH = 1920;
const JPEG_QUALITY = 0.7;

export function isCaptureSupported() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}

/** Must be called from a user gesture (click). Rejects with NotAllowedError if the user cancels. */
export async function requestScreenStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: "monitor", frameRate: { max: 1 } },
    audio: false,
    // Chromium hints; ignored elsewhere.
    monitorTypeSurfaces: "include",
    selfBrowserSurface: "exclude",
    surfaceSwitching: "exclude",
    systemAudio: "exclude",
  } as DisplayMediaStreamOptions);
}

export function displaySurfaceOf(stream: MediaStream): string | undefined {
  const settings = stream.getVideoTracks()[0]?.getSettings() as MediaTrackSettings & { displaySurface?: string };
  return settings?.displaySurface;
}

interface ImageCaptureLike {
  grabFrame(): Promise<ImageBitmap>;
}

/**
 * Grabs one frame as a JPEG. ImageCapture (Chromium) keeps working while the
 * tab is in the background; other browsers fall back to a <video> element.
 */
export async function grabFrame(stream: MediaStream, video: HTMLVideoElement): Promise<Blob> {
  const track = stream.getVideoTracks()[0];
  if (!track || track.readyState !== "live") throw new Error("The screen-sharing stream has ended.");

  let source: CanvasImageSource;
  let width: number;
  let height: number;
  const Ctor = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (Ctor) {
    const bitmap = await new Ctor(track).grabFrame();
    source = bitmap;
    width = bitmap.width;
    height = bitmap.height;
  } else {
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      await video.play();
    }
    source = video;
    width = video.videoWidth;
    height = video.videoHeight;
  }
  if (!width || !height) throw new Error("No frame is available yet.");

  const scale = Math.min(1, MAX_WIDTH / width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (source instanceof ImageBitmap) source.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't encode the screenshot."))), "image/jpeg", JPEG_QUALITY)
  );
}
