import { Agent, Instruct, loadFileContent } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

async function analyzeImage() {
  const imageFile = await loadFileContent("./examples/data/economist-brainy-imports.png");

  const instruct = new Instruct("What are the data that is shown in the image.");
  instruct.addFile(imageFile);

  const agent = new Agent(instruct, { provider, model });
  const result = await agent.start().final;

  console.log(result.response);
}

analyzeImage();
