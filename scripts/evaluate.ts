import { readFile } from "node:fs/promises";
import { evaluate } from "../shared/evaluation";
const input = process.argv[2]
  ? (JSON.parse(await readFile(process.argv[2], "utf8")) as unknown)
  : undefined;
console.log(JSON.stringify(evaluate(input), null, 2));
