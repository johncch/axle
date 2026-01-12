import { ConsoleWriter, Instruct } from "../../src/index.js";
import execTool from "../../src/tools/exec.js";
import readFromDiskTool from "../../src/tools/read-from-disk.js";
import writeToDiskTool from "../../src/tools/write-to-disk.js";
import { getAxle } from "./helper.js";

const prompt = `
Run \`npx tsx scripts/getModels.ts\` to get available models.
There are some ai providers in this repository under src/ai/
Read the existing models.ts files in each ai provider except for ollama.
Filter to modern models and update the files.
`;

const instruct = Instruct.with(prompt);
instruct.addTools([execTool, writeToDiskTool, readFromDiskTool]);
const axle = getAxle();
axle.addWriter(new ConsoleWriter());
const result = await axle.execute(instruct);
