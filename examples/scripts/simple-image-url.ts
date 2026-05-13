import { Agent, Instruct } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

const IMAGE_URL = "https://images-assets.nasa.gov/image/as17-148-22727/as17-148-22727~orig.jpg";

async function describeImageByUrl() {
  const instruct = new Instruct({ prompt: "In one sentence, what is shown in this image?" });
  instruct.addFile({
    kind: "image",
    mimeType: "image/jpeg",
    name: "earth-apollo-17.jpg",
    source: { type: "url", url: IMAGE_URL },
  });

  const agent = new Agent({ provider, model });
  const result = await agent.send(instruct).final;

  console.log(result.response);
}

describeImageByUrl();
