import { ToolExecutable, ToolSchema } from "./types.js";

const calculatorToolSchema: ToolSchema = {
  name: "calculator",
  description: "Performs basic arithmetic operations",
  parameters: {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description:
          "The operation to perform (add, subtract, multiply, divide)",
        enum: ["add", "subtract", "multiply", "divide"],
      },
      a: {
        type: "number",
        description: "First operand",
      },
      b: {
        type: "number",
        description: "Second operand",
      },
    },
    required: ["operation", "a", "b"],
  },
};

const calculatorTool: ToolExecutable = {
  name: "calculator",
  schema: calculatorToolSchema,
  execute: async (params) => {
    const { operation, a, b } = params;

    switch (operation) {
      case "add":
        return `${a} + ${b} = ${a + b}`;
      case "subtract":
        return `${a} - ${b} = ${a - b}`;
      case "multiply":
        return `${a} * ${b} = ${a * b}`;
      case "divide":
        if (b === 0) {
          throw new Error("Cannot divide by zero");
        }
        return `${a} / ${b} = ${a / b}`;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

export default calculatorTool;
