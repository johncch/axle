import { z } from "zod";
import type { Tool } from "./types.js";

const calculatorSchema = z.object({
  operation: z
    .enum(["add", "subtract", "multiply", "divide"])
    .describe("The operation to perform (add, subtract, multiply, divide)"),
  a: z.number().describe("First operand"),
  b: z.number().describe("Second operand"),
});

const calculatorTool: Tool<typeof calculatorSchema> = {
  name: "calculator",
  description: "Performs basic arithmetic operations",
  schema: calculatorSchema,
  execute: async ({ operation, a, b }) => {
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
        // This case should be unreachable due to Zod validation
        throw new Error(`Unknown operation: ${operation}`);
    }
  },
};

export default calculatorTool;
