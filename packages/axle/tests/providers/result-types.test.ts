import { describe, expectTypeOf, test } from "vitest";
import type {
  AgentErrorResult,
  AgentResult,
  AxleProviderFailure,
  GenerateResult,
  StreamResult,
} from "../../src/index.js";

describe("provider result types", () => {
  test("allow ergonomic error access before ok narrowing", () => {
    expectTypeOf<GenerateResult["error"]>().toEqualTypeOf<AxleProviderFailure | undefined>();
    expectTypeOf<StreamResult["error"]>().toEqualTypeOf<AxleProviderFailure | undefined>();
    expectTypeOf<(AgentResult | AgentErrorResult)["error"]>().toEqualTypeOf<
      AxleProviderFailure | undefined
    >();
  });

  test("narrow error to AxleProviderFailure when ok is false", () => {
    function expectNarrowedError(result: StreamResult) {
      if (!result.ok) {
        expectTypeOf(result.error).toEqualTypeOf<AxleProviderFailure>();
      }
    }

    expectTypeOf(expectNarrowedError).toEqualTypeOf<(result: StreamResult) => void>();
  });
});
