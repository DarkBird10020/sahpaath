import { describe, expect, it } from "vitest";
import { buildMetric, metricsEnabled, routeShape } from "../server/metrics";

describe("CloudWatch embedded metric format", () => {
  it("puts the value under its own name, where CloudWatch looks for it", () => {
    const doc = buildMetric({ name: "LessonPublished", value: 1 }, 1_700_000_000_000);
    expect(doc.LessonPublished).toBe(1);
    const meta = doc._aws as { Timestamp: number; CloudWatchMetrics: { Namespace: string; Metrics: { Name: string; Unit: string }[] }[] };
    expect(meta.Timestamp).toBe(1_700_000_000_000);
    expect(meta.CloudWatchMetrics[0].Namespace).toBe("SahPaath");
    expect(meta.CloudWatchMetrics[0].Metrics).toEqual([{ Name: "LessonPublished", Unit: "Count" }]);
  });

  it("declares every dimension it sets, and sets every dimension it declares", () => {
    const doc = buildMetric({
      name: "RequestLatency",
      value: 12.5,
      unit: "Milliseconds",
      dimensions: { Route: "/api/lessons", Status: "200" },
    });
    const meta = doc._aws as { CloudWatchMetrics: { Dimensions: string[][] }[] };
    const declared = meta.CloudWatchMetrics[0].Dimensions[0];
    expect(declared).toEqual(["Route", "Status"]);
    // A dimension CloudWatch is told about but cannot find is dropped silently,
    // so the two have to agree.
    for (const name of declared) expect(doc[name]).toBeDefined();
    expect(doc.RequestLatency).toBe(12.5);
  });

  it("keeps properties on the line without turning them into metrics", () => {
    const doc = buildMetric({ name: "DiagramAnalysed", value: 1, properties: { jobId: "abc", labels: 23 } });
    expect(doc.jobId).toBe("abc");
    const meta = doc._aws as { CloudWatchMetrics: { Metrics: { Name: string }[] }[] };
    expect(meta.CloudWatchMetrics[0].Metrics.map((m) => m.Name)).toEqual(["DiagramAnalysed"]);
  });

  it("stays quiet unless the lines have somewhere to go", () => {
    expect(metricsEnabled({})).toBe(false);
    expect(metricsEnabled({ SAHPAATH_METRICS: "emf" })).toBe(true);
    expect(metricsEnabled({ SAHPAATH_METRICS: "off", AWS_LAMBDA_FUNCTION_NAME: "worker" })).toBe(false);
    // On Lambda and on ECS, stdout already reaches CloudWatch Logs.
    expect(metricsEnabled({ AWS_LAMBDA_FUNCTION_NAME: "worker" })).toBe(true);
    expect(metricsEnabled({ ECS_CONTAINER_METADATA_URI_V4: "http://169.254.170.2/v4/abc" })).toBe(true);
  });
});

describe("route shapes", () => {
  it("collapses ids so a lesson does not become its own metric", () => {
    expect(routeShape("/api/lessons/8f3a1c22-0b4e-4f7a-9d21-7c5b2e1a9f04/decision")).toBe(
      "/api/lessons/:id/decision",
    );
    expect(routeShape("/api/published/3f9a2b7c1d4e5f60")).toBe("/api/published/:id");
    expect(routeShape("/api/lessons/42")).toBe("/api/lessons/:id");
  });

  it("leaves a route that carries no id alone", () => {
    expect(routeShape("/api/health")).toBe("/api/health");
    expect(routeShape("/api/v1/lessons")).toBe("/api/v1/lessons");
  });
});
