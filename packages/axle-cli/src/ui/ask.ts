import {
  CANCEL_SYMBOL,
  ConfirmPrompt,
  isCancel,
  PasswordPrompt,
  Prompt,
  SelectPrompt,
  TextPrompt,
  type Validate,
} from "@clack/core";
import type { Readable, Writable } from "node:stream";
import { styleText } from "node:util";

export { CANCEL_SYMBOL, isCancel };

const unicode =
  process.platform !== "win32" || Boolean(process.env.WT_SESSION ?? process.env.TERM_PROGRAM);
const GLYPH = {
  question: "?",
  cursor: ">",
  success: unicode ? "✓" : "+",
  failure: unicode ? "✗" : "x",
  warning: "!",
  info: "i",
  mask: "*",
};

async function run<T>(prompt: Prompt<T>): Promise<T | typeof CANCEL_SYMBOL> {
  const result = await prompt.prompt();
  return result === undefined ? CANCEL_SYMBOL : result;
}

type State = "initial" | "active" | "cancel" | "submit" | "error" | "validating";

function questionLine(state: State, message: string): string {
  const mark =
    state === "cancel"
      ? styleText("red", GLYPH.question)
      : state === "error"
        ? styleText("red", GLYPH.question)
        : styleText("green", GLYPH.question);
  return `${mark} ${styleText("bold", message)}`;
}

function answered(state: State, message: string, answer: string): string {
  const shown =
    state === "cancel" ? styleText(["strikethrough", "dim"], answer) : styleText("cyan", answer);
  return `${questionLine(state, message)} ${shown}`;
}

function errorLine(error: string): string {
  return `${styleText("red", GLYPH.failure)} ${styleText("red", error)}\n`;
}

interface CommonOptions {
  message: string;
  signal?: AbortSignal;
  input?: Readable;
  output?: Writable;
}

export interface TextOptions extends CommonOptions {
  placeholder?: string;
  initialValue?: string;
  validate?: Validate<string>;
}

export function text(opts: TextOptions): Promise<string | typeof CANCEL_SYMBOL> {
  const placeholder = opts.placeholder
    ? styleText("dim", opts.placeholder)
    : styleText(["inverse", "hidden"], "_");
  return run(
    new TextPrompt({
      validate: opts.validate,
      placeholder: opts.placeholder,
      initialValue: opts.initialValue,
      signal: opts.signal,
      input: opts.input,
      output: opts.output,
      render() {
        switch (this.state) {
          case "submit":
          case "cancel":
            return answered(this.state, opts.message, this.value ?? "");
          case "error":
            return `${questionLine(this.state, opts.message)} ${this.userInputWithCursor}\n${errorLine(this.error)}`;
          default: {
            const input = this.userInput ? this.userInputWithCursor : placeholder;
            return `${questionLine(this.state, opts.message)} ${input}\n`;
          }
        }
      },
    }),
  );
}

export interface PasswordOptions extends CommonOptions {
  validate?: Validate<string>;
}

export function password(opts: PasswordOptions): Promise<string | typeof CANCEL_SYMBOL> {
  return run(
    new PasswordPrompt({
      validate: opts.validate,
      mask: GLYPH.mask,
      signal: opts.signal,
      input: opts.input,
      output: opts.output,
      render() {
        switch (this.state) {
          case "submit":
          case "cancel":
            return answered(this.state, opts.message, this.masked);
          case "error":
            return `${questionLine(this.state, opts.message)} ${this.userInputWithCursor}\n${errorLine(this.error)}`;
          default:
            return `${questionLine(this.state, opts.message)} ${this.userInputWithCursor}\n`;
        }
      },
    }),
  );
}

export interface ConfirmOptions extends CommonOptions {
  initialValue?: boolean;
}

export function confirm(opts: ConfirmOptions): Promise<boolean | typeof CANCEL_SYMBOL> {
  return run(
    new ConfirmPrompt({
      active: "Yes",
      inactive: "No",
      initialValue: opts.initialValue ?? true,
      signal: opts.signal,
      input: opts.input,
      output: opts.output,
      render() {
        switch (this.state) {
          case "submit":
          case "cancel":
            return answered(this.state, opts.message, this.value ? "Yes" : "No");
          default: {
            const hint = this.value ? "(Y/n)" : "(y/N)";
            return `${questionLine(this.state, opts.message)} ${styleText("dim", hint)}\n`;
          }
        }
      },
    }),
  );
}

export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectOptions<T> extends CommonOptions {
  options: SelectOption<T>[];
  initialValue?: T;
}

export function select<T>(opts: SelectOptions<T>): Promise<T | typeof CANCEL_SYMBOL> {
  return run(
    new SelectPrompt<SelectOption<T>>({
      options: opts.options,
      initialValue: opts.initialValue,
      signal: opts.signal,
      input: opts.input,
      output: opts.output,
      render() {
        const current = this.options[this.cursor];
        switch (this.state) {
          case "submit":
          case "cancel":
            return answered(this.state, opts.message, current.label);
          default: {
            const header = `${questionLine(this.state, opts.message)} ${styleText("dim", "[Use arrows to move]")}`;
            const rows = this.options.map((option, index) => {
              const hint = option.hint ? ` ${styleText("dim", `(${option.hint})`)}` : "";
              if (index === this.cursor) {
                return `${styleText("cyan", GLYPH.cursor)} ${styleText("cyan", option.label)}${hint}`;
              }
              return `  ${option.label}${hint}`;
            });
            return `${header}\n${rows.join("\n")}\n`;
          }
        }
      },
    }),
  );
}

export function outro(message: string): void {
  process.stdout.write(`${message}\n`);
}

export function cancel(message: string): void {
  process.stdout.write(`${styleText("red", message)}\n`);
}

export const log = {
  success(message: string): void {
    process.stdout.write(`${styleText("green", GLYPH.success)} ${message}\n`);
  },
  warn(message: string): void {
    process.stdout.write(`${styleText("yellow", GLYPH.warning)} ${message}\n`);
  },
  info(message: string): void {
    process.stdout.write(`${styleText("blue", GLYPH.info)} ${message}\n`);
  },
  error(message: string): void {
    process.stdout.write(`${styleText("red", GLYPH.failure)} ${message}\n`);
  },
};
