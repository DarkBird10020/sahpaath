/**
 * The YouTube player, wrapped so the captions beside it can follow along.
 *
 * The embed is the privacy-preserving youtube-nocookie host, and the API script
 * is loaded once, only when someone actually picks a video, so a visitor who
 * never searches never talks to YouTube at all.
 */

type Player = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  playVideo: () => void;
  destroy: () => void;
};
type YT = {
  Player: new (
    el: HTMLElement,
    options: {
      videoId: string;
      host?: string;
      playerVars?: Record<string, string | number>;
      events?: { onReady?: () => void };
    },
  ) => Player;
};
declare global {
  interface Window {
    YT?: YT & { loaded?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let loading: Promise<YT> | null = null;
/** Loads YouTube's iframe API once per page and resolves when it is usable. */
export function loadYouTubeApi(): Promise<YT> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (loading) return loading;
  loading = new Promise<YT>((resolve, reject) => {
    // YouTube calls this global when the script is ready; chain any existing one
    // rather than replacing it.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("The YouTube player did not load."));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load the YouTube player. Check the connection."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export type { Player as YouTubePlayer };
