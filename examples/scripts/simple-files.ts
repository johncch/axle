import { Agent, Instruct, loadFileContent } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const instruct = new Instruct("What are the data that is shown in the image.");
instruct.addFile({
  kind: "image",
  mimeType: "image/png",
  name: "economist-brainy-imports.png",
  source: { type: "ref", ref: "key-1" },
});

const agent = new Agent({
  provider,
  model,
  fileResolver: async (params) => {
    // For demo: inspect what the resolver receives. Drop in real code.
    console.log(params);
    const imageFile = await loadFileContent(
      "./examples/data/economist-brainy-imports.png",
      "base64",
    );
    return { type: "base64", data: imageFile.source.data };
  },
});
const result = await agent.send(instruct).final;
console.log(result.response);
