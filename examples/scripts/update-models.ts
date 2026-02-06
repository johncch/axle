import { ConsoleWriter, Instruct } from "../../src/index.js";
import execTool from "../../src/tools/exec/index.js";
import readFileTool from "../../src/tools/read-file.js";
import writeFileTool from "../../src/tools/write-file.js";
import { getAxle } from "./helper.js";

const prompt = `
Run \`npx tsx scripts/getModels.ts\` to get available models.
There are some ai providers in this repository under src/ai/
Read the existing models.ts files in each ai provider except for ollama.
Filter to modern models and update the files.
`;

const instruct = Instruct.with(prompt);
instruct.addTools([execTool, writeFileTool, readFileTool]);
const axle = getAxle();
axle.addWriter(new ConsoleWriter());
const result = await axle.execute(instruct);
