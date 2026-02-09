import { config } from "dotenv";
import { Axle, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";
config();

async function analyzeImage() {
  const imageFile = await Axle.loadFileContent("./examples/data/economist-brainy-imports.png");

  const instruct = Instruct.with("What are the data that is shown in the image.", {
    description: "string",
  });
  instruct.addImage(imageFile);

  const axle = useCLIHelper();

  const result = await axle.execute(instruct);
  console.log(result);
  console.log((instruct.result as any)?.description);
}

analyzeImage();
