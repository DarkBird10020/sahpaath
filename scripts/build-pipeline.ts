import { build } from "esbuild";
await build({ entryPoints: ["server/cloud-pipeline.ts"], outfile: ".pipeline-build/index.cjs",
  platform: "node", target: "node22", format: "cjs", bundle: true, sourcemap: true });
