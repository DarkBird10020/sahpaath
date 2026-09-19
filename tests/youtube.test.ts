import { describe, it, expect } from "vitest";
import { lookupVideo, parseDuration, parseVideoId, readYouTubeConfig, searchYouTube } from "../server/youtube";
import { transcribeYouTube } from "../server/tutor";

// No network: every YouTube and Gemini reply below is canned.
const config = { apiKey: "k" };
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const ID = "aJPwUnZtycQ";

function fakeYouTube(...replies: unknown[]) {
  const urls: URL[] = [];
  const impl = (async (input: string | URL | Request) => {
    urls.push(new URL(String(input)));
    const next = replies.shift();
    if (next === undefined) throw new Error("unexpected extra call");
    return ok(next);
  }) as typeof fetch;
  return { impl, urls };
}
const searchReply = (...ids: string[]) => ({ items: ids.map((videoId) => ({ id: { videoId } })) });
const videoItem = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  snippet: {
    title: `Title ${id}`,
    channelTitle: "Ninja Nerd",
    publishedAt: "2017-08-03T17:27:34Z",
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } },
  },
  contentDetails: { duration: "PT12M30S" },
  status: { embeddable: true, privacyStatus: "public" },
  ...over,
});

describe("reading a YouTube video id", () => {
  it("accepts the shapes a learner actually pastes", () => {
    expect(parseVideoId(ID)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtube.com/watch?v=${ID}&t=42s`)).toBe(ID);
    expect(parseVideoId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseVideoId(`https://youtu.be/${ID}?si=abc`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseVideoId(`  https://www.youtube-nocookie.com/embed/${ID}  `)).toBe(ID);
  });
  it("refuses anything that is not a YouTube video", () => {
    for (const bad of ["", "pulmonary circulation", "https://example.com/watch?v=" + ID, "https://youtube.com/", "javascript:alert(1)", "https://www.youtube.com/watch?v=short"])
      expect(parseVideoId(bad)).toBeNull();
  });
});

describe("reading a duration", () => {
  it("covers the ISO 8601 forms YouTube returns", () => {
    expect(parseDuration("PT30S")).toBe(30);
    expect(parseDuration("PT12M30S")).toBe(750);
    expect(parseDuration("PT1H2M3S")).toBe(3723);
    expect(parseDuration("P1DT2H")).toBe(93600);
    // A live stream has no length, and must not be offered for captioning.
    expect(parseDuration("P0D")).toBe(0);
    expect(parseDuration("nonsense")).toBe(0);
  });
});

describe("configuration", () => {
  it("is absent until a key is set, and trims the key", () => {
    expect(readYouTubeConfig({})).toBeNull();
    expect(readYouTubeConfig({ YOUTUBE_API_KEY: "  " })).toBeNull();
    expect(readYouTubeConfig({ YOUTUBE_API_KEY: " abc " })).toEqual({ apiKey: "abc" });
  });
});

describe("searching", () => {
  it("asks for embeddable, safe results and returns them with their length", async () => {
    const { impl, urls } = fakeYouTube(searchReply(ID), { items: [videoItem(ID)] });
    const results = await searchYouTube(config, "pulmonary circulation", impl, () => 1000);
    expect(urls[0].pathname).toBe("/youtube/v3/search");
    expect(urls[0].searchParams.get("videoEmbeddable")).toBe("true");
    expect(urls[0].searchParams.get("safeSearch")).toBe("strict");
    expect(urls[0].searchParams.get("type")).toBe("video");
    expect(urls[0].searchParams.get("key")).toBe("k");
    // The second call is the cheap one that carries the durations.
    expect(urls[1].pathname).toBe("/youtube/v3/videos");
    expect(results).toEqual([
      {
        videoId: ID,
        title: `Title ${ID}`,
        channel: "Ninja Nerd",
        publishedAt: "2017-08-03T17:27:34Z",
        thumbUrl: `https://i.ytimg.com/vi/${ID}/mqdefault.jpg`,
        durationSeconds: 750,
        tooLong: false,
      },
    ]);
  });

  it("marks a video past the captioning limit instead of hiding it", async () => {
    const { impl } = fakeYouTube(searchReply(ID), { items: [videoItem(ID, { contentDetails: { duration: "PT45M" } })] });
    const [result] = await searchYouTube(config, "long lecture", impl, () => 2000);
    expect(result.durationSeconds).toBe(2700);
    expect(result.tooLong).toBe(true);
  });

  it("drops live streams and anything that cannot be played here", async () => {
    const { impl } = fakeYouTube(searchReply("aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc", ID), {
      items: [
        videoItem("aaaaaaaaaaa", { contentDetails: { duration: "P0D" } }),
        videoItem("bbbbbbbbbbb", { status: { embeddable: false, privacyStatus: "public" } }),
        videoItem("ccccccccccc", { status: { embeddable: true, privacyStatus: "unlisted" } }),
        videoItem(ID),
      ],
    });
    const results = await searchYouTube(config, "mixed", impl, () => 3000);
    expect(results.map((r) => r.videoId)).toEqual([ID]);
  });

  it("answers a repeated search from the cache, so the daily quota is not spent twice", async () => {
    const { impl, urls } = fakeYouTube(searchReply(ID), { items: [videoItem(ID)] });
    const clock = () => 10_000;
    const first = await searchYouTube(config, "cached query", impl, clock);
    const second = await searchYouTube(config, "CACHED QUERY", impl, clock);
    expect(second).toEqual(first);
    // Two calls in total, not four: the second search never reached YouTube.
    expect(urls).toHaveLength(2);
  });

  it("says plainly when the day's allowance is gone", async () => {
    const impl = (async () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 })) as typeof fetch;
    await expect(searchYouTube(config, "anything at all", impl, () => 99_999)).rejects.toThrow(
      /allowance is used up/i,
    );
  });
});

describe("looking one video up", () => {
  it("returns the video for a pasted link", async () => {
    const { impl, urls } = fakeYouTube({ items: [videoItem(ID)] });
    const video = await lookupVideo(config, ID, impl);
    expect(urls).toHaveLength(1);
    expect(video?.title).toBe(`Title ${ID}`);
    expect(video?.tooLong).toBe(false);
  });
  it("returns nothing for a video that does not exist", async () => {
    const { impl } = fakeYouTube({ items: [] });
    expect(await lookupVideo(config, ID, impl)).toBeNull();
  });
});

describe("captions for a YouTube video", () => {
  const gemini = { apiKey: "k", model: "gemini-test" };
  const geminiReply = (text: string) =>
    new Response(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }] }), { status: 200 });

  it("sends the video by address and never downloads it", async () => {
    let sent: { contents: { parts: Record<string, unknown>[] }[] } | null = null;
    const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return geminiReply(
        JSON.stringify({
          segments: [
            { start: 3.5, end: 1.5, text: "  Blood leaves the right ventricle.  " },
            { start: 0, end: 2, text: "Welcome back." },
            { start: 5, end: 6, text: "   " },
          ],
          hardWords: [{ word: "ventricle", meaning: "A lower chamber of the heart." }],
        }),
      );
    }) as typeof fetch;
    const t = await transcribeYouTube(gemini, `https://www.youtube.com/watch?v=${ID}`, impl);
    const parts = sent!.contents[0].parts;
    expect(parts[0]).toEqual({ fileData: { fileUri: `https://www.youtube.com/watch?v=${ID}` } });
    // Nothing is inlined: the bytes never pass through this server.
    expect(parts.some((p) => "inlineData" in p)).toBe(false);
    // Sorted, trimmed, blank lines dropped, and an end before its start clamped.
    expect(t.segments).toEqual([
      { startMs: 0, endMs: 2000, text: "Welcome back." },
      { startMs: 3500, endMs: 3500, text: "Blood leaves the right ventricle." },
    ]);
    expect(t.hardWords).toEqual([{ word: "ventricle", meaning: "A lower chamber of the heart." }]);
  });

  it("returns empty lists for a silent video rather than inventing lines", async () => {
    const impl = (async () => geminiReply(JSON.stringify({ segments: [], hardWords: [] }))) as typeof fetch;
    const t = await transcribeYouTube(gemini, `https://www.youtube.com/watch?v=${ID}`, impl);
    expect(t.segments).toEqual([]);
    expect(t.hardWords).toEqual([]);
  });
});
