import { Agent, Instruct, loadFileContent } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

const [provider, model] = useCLIHelper();

async function summarizePdf() {
  const pdf = await loadFileContent("./examples/data/designing-a-new-foundation.pdf");

  const instruct = new Instruct({ prompt: "Summarize this document in 2-3 sentences." });
  instruct.addFile(pdf);

  const agent = new Agent({ provider, model });
  const result = await agent.send(instruct).final;

  console.log(result.response);
}

summarizePdf();
