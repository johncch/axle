import { config } from "dotenv";
import * as z from "zod";
import { Axle, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";
config();

async function analyzeImage() {
  const imageFile = await Axle.loadFileContent("./examples/data/economist-brainy-imports.png");

  const instruct = new Instruct("What are the data that is shown in the image.", {
    description: z.string(),
  });
  instruct.addFile(imageFile);

  const axle = useCLIHelper();

  const result = await axle.execute(instruct);
  console.log(result);
  console.log(result.response?.description);
}

analyzeImage();
