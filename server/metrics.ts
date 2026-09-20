/**
 * Application metrics for Amazon CloudWatch, in Embedded Metric Format.
 *
 * EMF is a shape of JSON log line. Anything the process writes to stdout on
 * AWS already reaches CloudWatch Logs, and CloudWatch reads lines in this shape
 * and extracts metrics from them. So a real metric costs one log line: no SDK,
 * no API call, no extra permission, and nothing to fail if CloudWatch is not
 * there. That is what makes it usable in a project that has to run just as well
 * on a teacher's laptop with no AWS account at all.
 *
 * Off unless asked for, because a line of EMF in a terminal is noise:
 * `SAHPAATH_METRICS=emf` turns it on, and it turns itself on when the process
 * is running inside Lambda or ECS, where the lines have somewhere to go.
 *
 * Reference: Amazon CloudWatch Embedded Metric Format specification.
 */

export type MetricUnit = "Count" | "Milliseconds" | "Bytes" | "Percent" | "None";

/** One measurement, with the dimensions CloudWatch should break it down by. */
export interface Measurement {
  name: string;
  value: number;
  unit?: MetricUnit;
  /** Becomes CloudWatch dimensions: keep these few and low-cardinality. */
  dimensions?: Record<string, string>;
  /** Extra fields kept on the log line for searching, but not made metrics. */
  properties?: Record<string, string | number>;
}

const NAMESPACE = "SahPaath";

/** Whether the lines have anywhere to go. */
export function metricsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SAHPAATH_METRICS === "off") return false;
  if (env.SAHPAATH_METRICS === "emf") return true;
  // Lambda and ECS both set these, and both forward stdout to CloudWatch Logs.
  return Boolean(env.AWS_LAMBDA_FUNCTION_NAME || env.ECS_CONTAINER_METADATA_URI_V4);
}

/**
 * The EMF document for a measurement. Pure, so the shape can be tested without
 * writing anything anywhere.
 */
export function buildMetric(measurement: Measurement, timestamp = Date.now()): Record<string, unknown> {
  const dimensions = measurement.dimensions ?? {};
  const names = Object.keys(dimensions);
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          // One set: every metric in this document is broken down the same way.
          // An empty set still records the metric, across the namespace.
          Dimensions: names.length ? [names] : [[]],
          Metrics: [{ Name: measurement.name, Unit: measurement.unit ?? "Count" }],
        },
      ],
    },
    ...dimensions,
    ...(measurement.properties ?? {}),
    [measurement.name]: measurement.value,
  };
}

/** Writes one measurement, or nothing at all when there is nowhere to write. */
export function recordMetric(measurement: Measurement): void {
  if (!metricsEnabled()) return;
  console.log(JSON.stringify(buildMetric(measurement)));
}

/**
 * Collapses a path to the route it belongs to, so a dimension is the shape of
 * a request rather than one particular one. `/api/lessons/8f3a.../decision`
 * becomes `/api/lessons/:id/decision`. Without this each lesson would become
 * its own CloudWatch metric: useless to read and billed per metric.
 */
export function routeShape(path: string): string {
  return path
    .split("/")
    .map((part) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) ||
      /^[0-9a-f]{16,}$/i.test(part) ||
      /^\d+$/.test(part)
        ? ":id"
        : part,
    )
    .join("/");
}
