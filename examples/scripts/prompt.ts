import { config } from "dotenv";
import { ResultType } from "../../src/core/types.js";
import { ConsoleWriter, Instruct, LogLevel } from "../../src/index.js";
import { useCLIHelper } from "./helper.js";

config();

const axle = useCLIHelper();
const instruct = Instruct.with("Please generate 5 {{ items }} and their descriptions.", {
  results: [{ item: ResultType.String, description: ResultType.String }],
});
instruct.addInput("items", "flowers");
// instruct.addReference("Very nice to meet you, Doe!");
instruct.addInstructions("Please include colors in the description");

const prompt = instruct.compile({});
console.log(prompt.message);
console.log("--");
console.log(prompt.instructions);

axle.recorder.level = LogLevel.Info;
axle.addWriter(new ConsoleWriter());
const result = await axle.execute(instruct);

console.log(result);
console.log(JSON.stringify(instruct.result));
console.log("--");
console.log(instruct.rawResponse);
