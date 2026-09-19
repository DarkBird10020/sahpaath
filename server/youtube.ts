/**
 * YouTube search for the Watch & listen page.
 *
 * The key stays on this side: a browser-held key is readable by anyone who
 * opens devtools, and this one is billed against the project's daily quota.
 *
 * Quota is the reason for the cache below. search.list costs 100 units of the
 * 10,000 free units a day and videos.list costs 1, so every search spends
 * roughly a hundredth of the day's allowance — about 99 searches for everyone
 * using this server, not per visitor. Repeats inside the window are answered
 * from memory instead of spending again.
 */

export interface YouTubeConfig {
  apiKey: string;
}
export function readYouTubeConfig(env: NodeJS.ProcessEnv): YouTubeConfig | null {
  const apiKey = env.YOUTUBE_API_KEY?.trim();
  return apiKey ? { apiKey } : null;
}

/** `userMessage` is our own wording and safe to show; `message` may quote the provider. */
export class YouTubeError extends Error {
  constructor(readonly status: number | null, readonly userMessage: string, detail = "") {
    super(detail ? `${userMessage} ${detail}` : userMessage);
    this.name = "YouTubeError";
  }
}

export type YouTubeResult = {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
  thumbUrl: string;
  durationSeconds: number;
  /** True when the video is longer than the AI captioning limit. */
  tooLong: boolean;
};

/** Captions cost tokens per minute of video, so the limit matches the file path's. */
export const MAX_VIDEO_SECONDS = 30 * 60;

const ID = /^[\w-]{11}$/;
/**
 * The video id from a watch URL, a share link, an embed or a bare id. Returns
 * null for anything else, so a pasted address is never fetched blindly.
 */
export function parseVideoId(input: string): string | null {
  const text = input.trim();
  if (ID.test(text)) return text;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return ID.test(id) ? id : null;
  }
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  const v = url.searchParams.get("v");
  if (v && ID.test(v)) return v;
  const path = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
  return path ? path[1] : null;
}

/** Seconds from an ISO 8601 duration such as PT1H2M3S. */
export function parseDuration(iso: string): number {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

type Fetch = typeof fetch;
async function call(config: YouTubeConfig, path: string, params: Record<string, string>, fetchImpl: Fetch) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", config.apiKey);
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
  } catch (error) {
    throw new YouTubeError(null, "Could not reach YouTube. Check the connection and try again.", (error as Error).message);
  }
  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: { reason?: string }[] };
    items?: unknown[];
  };
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason ?? "";
    // The daily allowance is shared by everyone on this server, so say so plainly.
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded")
      throw new YouTubeError(response.status, "Today's YouTube search allowance is used up. It resets at midnight Pacific time; paste a video link instead.");
    if (response.status === 403)
      throw new YouTubeError(response.status, "YouTube refused the search. Check that the API key is valid and the YouTube Data API is enabled.", data.error?.message ?? "");
    throw new YouTubeError(response.status, "YouTube search is unavailable right now. Try again, or paste a video link.", (data.error?.message ?? "").slice(0, 200));
  }
  return data;
}

/** Results are stable enough that a short memory is worth ~100 quota units. */
const cache = new Map<string, { at: number; results: YouTubeResult[] }>();
const CACHE_MS = 10 * 60_000;

export async function searchYouTube(
  config: YouTubeConfig,
  query: string,
  fetchImpl: Fetch = fetch,
  now = () => Date.now(),
): Promise<YouTubeResult[]> {
  const q = query.trim().slice(0, 120);
  if (!q) return [];
  const key = q.toLowerCase();
  const hit = cache.get(key);
  if (hit && now() - hit.at < CACHE_MS) return hit.results;

  const found = (await call(
    config,
    "search",
    {
      part: "snippet",
      type: "video",
      q,
      maxResults: "9",
      // Only what a learner can actually play here, and nothing adult.
      videoEmbeddable: "true",
      safeSearch: "strict",
    },
    fetchImpl,
  )) as { items?: { id?: { videoId?: string } }[] };
  const ids = (found.items ?? []).map((i) => i.id?.videoId).filter((v): v is string => !!v && ID.test(v));
  if (!ids.length) {
    cache.set(key, { at: now(), results: [] });
    return [];
  }

  // A second call, one quota unit, for the durations: search.list does not
  // return them, and length decides whether captioning is possible at all.
  const details = (await call(
    config,
    "videos",
    { part: "snippet,contentDetails,status", id: ids.join(",") },
    fetchImpl,
  )) as {
    items?: {
      id?: string;
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
      contentDetails?: { duration?: string };
      status?: { embeddable?: boolean; privacyStatus?: string };
    }[];
  };
  const byId = new Map((details.items ?? []).map((v) => [v.id ?? "", v]));
  const results = ids
    .map((videoId) => {
      const v = byId.get(videoId);
      if (!v?.snippet || v.status?.embeddable === false || v.status?.privacyStatus !== "public") return null;
      const durationSeconds = parseDuration(v.contentDetails?.duration ?? "");
      // A zero duration means a live stream; there is no fixed thing to caption.
      if (!durationSeconds) return null;
      return {
        videoId,
        title: (v.snippet.title ?? "").slice(0, 200),
        channel: (v.snippet.channelTitle ?? "").slice(0, 120),
        publishedAt: v.snippet.publishedAt ?? "",
        thumbUrl: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? "",
        durationSeconds,
        tooLong: durationSeconds > MAX_VIDEO_SECONDS,
      } satisfies YouTubeResult;
    })
    .filter((r): r is YouTubeResult => r !== null);
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: now(), results });
  return results;
}

/** One video's title and length, for a link the learner pasted themselves. */
export async function lookupVideo(
  config: YouTubeConfig,
  videoId: string,
  fetchImpl: Fetch = fetch,
): Promise<YouTubeResult | null> {
  const details = (await call(
    config,
    "videos",
    { part: "snippet,contentDetails,status", id: videoId },
    fetchImpl,
  )) as {
    items?: {
      id?: string;
      snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: Record<string, { url?: string }> };
      contentDetails?: { duration?: string };
      status?: { embeddable?: boolean; privacyStatus?: string };
    }[];
  };
  const v = details.items?.[0];
  if (!v?.snippet) return null;
  const durationSeconds = parseDuration(v.contentDetails?.duration ?? "");
  return {
    videoId,
    title: (v.snippet.title ?? "").slice(0, 200),
    channel: (v.snippet.channelTitle ?? "").slice(0, 120),
    publishedAt: v.snippet.publishedAt ?? "",
    thumbUrl: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? "",
    durationSeconds,
    tooLong: durationSeconds > MAX_VIDEO_SECONDS,
  };
}
