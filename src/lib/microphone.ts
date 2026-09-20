/** Ask for the microphone the way the browser expects: a secure page, then
 * getUserMedia (which shows the Allow / Block prompt), then release it so the
 * speech service can use it. Returns a plain-language problem, or null. */
export async function requestMicrophone(): Promise<string | null> {
  if (!window.isSecureContext)
    return "The microphone only works on a secure page. Open this classroom at its https:// address, then try again.";
  if (!navigator.mediaDevices?.getUserMedia) return "This browser cannot use a microphone. Type captions instead.";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    return null;
  } catch (error) {
    switch ((error as DOMException).name) {
      case "NotAllowedError":
      case "SecurityError":
        return "The microphone is blocked. Click the lock icon beside the address, set Microphone to Allow, and try again.";
      case "NotFoundError":
      case "OverconstrainedError":
        return "No microphone was found. Plug one in, or type captions instead.";
      case "NotReadableError":
        return "Another app is using the microphone. Close it and try again.";
      default:
        return "The microphone could not be opened. Type captions instead.";
    }
  }
}

/** Speech-service error codes that are normal pauses, not failures. */
export const quietSpeechErrors = new Set(["no-speech", "aborted"]);

export function speechErrorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
      return "The microphone is blocked. Click the lock icon beside the address, set Microphone to Allow, and try again.";
    case "service-not-allowed":
      return "The browser's speech service is switched off. In Windows open Settings, Privacy & security, Speech, and turn on Online speech recognition. Or type captions.";
    case "audio-capture":
      return "No microphone was found. Plug one in, or type captions instead.";
    case "network":
      return "The browser's speech service could not be reached. Check your connection and try again, or type captions.";
    default:
      return `Speech recognition stopped (${code}). Type captions or start again.`;
  }
}
