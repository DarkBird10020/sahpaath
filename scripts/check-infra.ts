/**
 * Checks the CloudFormation/SAM template without needing the AWS CLI: every
 * Ref, Fn::GetAtt and Fn::Sub must point at a resource or parameter that the
 * template actually declares. A broken reference is only found at deploy time
 * otherwise, and deploy time is the wrong moment to find it.
 *
 * Run: npx tsx scripts/check-infra.ts
 */
import { readFileSync } from "node:fs";

const path = process.argv[2] ?? "infra/diagram-pipeline.json";
const template = JSON.parse(readFileSync(path, "utf8")) as {
  Parameters?: Record<string, unknown>;
  Resources: Record<string, { Type: string }>;
  Outputs?: Record<string, unknown>;
};

/** Names CloudFormation resolves on its own, plus everything declared here. */
const pseudo = [
  "AWS::AccountId",
  "AWS::Region",
  "AWS::Partition",
  "AWS::StackName",
  "AWS::StackId",
  "AWS::NoValue",
  "AWS::URLSuffix",
];
const known = new Set([
  ...Object.keys(template.Resources),
  ...Object.keys(template.Parameters ?? {}),
  ...pseudo,
]);

const unresolved: string[] = [];
const walk = (node: unknown, path: string): void => {
  if (Array.isArray(node)) {
    node.forEach((item, i) => walk(item, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === "Ref" && typeof value === "string" && !known.has(value)) {
      unresolved.push(`${path}.Ref -> ${value}`);
    }
    if (key === "Fn::GetAtt") {
      const target = Array.isArray(value) ? String(value[0]) : String(value).split(".")[0];
      if (!known.has(target)) unresolved.push(`${path}.Fn::GetAtt -> ${target}`);
    }
    if (key === "Fn::Sub" && typeof value === "string") {
      for (const match of value.matchAll(/\$\{([A-Za-z0-9:.]+)\}/g)) {
        const target = match[1].split(".")[0];
        if (!known.has(target)) unresolved.push(`${path}.Fn::Sub -> ${match[1]}`);
      }
    }
    walk(value, `${path}.${key}`);
  }
};
walk(template, "");

const types = [...new Set(Object.values(template.Resources).map((r) => r.Type))].sort();
console.log(`${path}: ${Object.keys(template.Resources).length} resources, ${types.length} resource types`);
for (const type of types) console.log(`  ${type}`);

if (unresolved.length) {
  console.error(`\n${unresolved.length} unresolved reference(s):`);
  for (const line of unresolved) console.error(`  ${line}`);
  process.exit(1);
}
console.log("\nEvery Ref, Fn::GetAtt and Fn::Sub resolves.");
