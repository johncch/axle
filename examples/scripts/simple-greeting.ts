import { config } from "dotenv";
import { Instruct, WriteToDisk } from "../../src/index.js";
import { ConsoleWriter } from "../../src/recorder/consoleWriter.js";
import { LogLevel } from "../../src/recorder/types.js";
import { getAxle } from "./helper.js";
config();

const instruct = Instruct.with("Please provide a friendly greeting for {{name}}");
instruct.addInput("name", "John Doe");

const writeAction = new WriteToDisk("./output/greeting-{{name}}.txt", "{{response}}");

const axle = getAxle();
axle.recorder.level = LogLevel.Debug;
axle.addWriter(new ConsoleWriter());
const result = await axle.execute(instruct, writeAction);

console.log(result);
console.log(instruct.result?.response);
