import { describe, expectTypeOf, test } from "vitest";
import type {
  AgentErrorResult,
  AgentResult,
  AxleFailure,
  GenerateResult,
  StreamResult,
} from "../../src/index.js";

describe("provider result types", () => {
  test("allow ergonomic error access before ok narrowing", () => {
    expectTypeOf<GenerateResult["error"]>().toEqualTypeOf<AxleFailure | undefined>();
    expectTypeOf<StreamResult["error"]>().toEqualTypeOf<AxleFailure | undefined>();
    expectTypeOf<(AgentResult | AgentErrorResult)["error"]>().toEqualTypeOf<
      AxleFailure | undefined
    >();
  });

  test("narrow error to AxleFailure when ok is false", () => {
    function expectNarrowedError(result: StreamResult) {
      if (!result.ok) {
        expectTypeOf(result.error).toEqualTypeOf<AxleFailure>();
      }
    }

    expectTypeOf(expectNarrowedError).toEqualTypeOf<(result: StreamResult) => void>();
  });
});
