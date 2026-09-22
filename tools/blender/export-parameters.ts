import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { shellParameters } from "./shell-parameters";
import { models } from "./models";
import { coverage } from "./params/coverage";

const output = resolve("tools/blender/out/parameters.json");
mkdirSync(resolve("tools/blender/out"), { recursive: true });
writeFileSync(
  output,
  JSON.stringify(
    {
      schemaVersion: 1,
      status: "provisional-authoring",
      models: models.map((spec) => ({
        ...shellParameters(spec),
        sourceUrl: spec.sourceUrl,
        referenceUrl: spec.referenceUrl,
        color: spec.color,
        seam: spec.seam,
        descriptors: spec,
      })),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Wrote ${models.length} provisional shell definitions to ${output}`,
);
writeFileSync(
  resolve("tools/blender/out/coverage.json"),
  JSON.stringify(
    coverage.map((spec) => ({
      ...shellParameters(spec),
      color: spec.color,
      seam: spec.seam,
      sourceUrl: spec.sourceUrl,
    })),
    null,
    2,
  ) + "\n",
);
