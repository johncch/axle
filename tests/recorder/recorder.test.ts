import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Recorder } from "../../src/recorder/recorder.js";
import { LogLevel, RecorderEntry, RecorderWriter, TaskStatus } from "../../src/recorder/types.js";

// Helper type for test mocks
type HandleEventFn = (event: RecorderEntry) => void;

describe("Recorder", () => {
  let recorder: Recorder;

  beforeEach(() => {
    // Mock UUID generation for consistent testing
    vi.spyOn(global.crypto, "randomUUID").mockReturnValue("00000000-0000-0000-0000-000000000000");

    // Mock Date.now() for consistent timestamps
    vi.spyOn(Date, "now").mockReturnValue(1000000000000);

    recorder = new Recorder();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("initialization", () => {
    test("initializes with default values", () => {
      expect(recorder.instanceId).toBe("00000000-0000-0000-0000-000000000000");
      expect(recorder.level).toBe(LogLevel.Info);
      expect(recorder.getLogs()).toEqual([]);
    });
  });

  describe("writer subscription", () => {
    test("subscribes writers", () => {
      const mockWriter: RecorderWriter = {
        handleEvent: vi.fn() as unknown as HandleEventFn,
      };

      recorder.subscribe(mockWriter);
      recorder.info?.log("Test message");

      expect(mockWriter.handleEvent).toHaveBeenCalledTimes(1);
      expect(mockWriter.handleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          level: LogLevel.Info,
          kind: "body",
          time: 1000000000000,
          payload: [{ message: "Test message" }],
        }),
      );
    });

    test("unsubscribes writers", () => {
      const mockWriter: RecorderWriter = {
        handleEvent: vi.fn() as unknown as HandleEventFn,
      };

      recorder.subscribe(mockWriter);
      recorder.unsubscribe(mockWriter);
      recorder.info?.log("Test message");

      expect(mockWriter.handleEvent).not.toHaveBeenCalled();
    });

    test("doesn't duplicate writer subscriptions", () => {
      const mockWriter: RecorderWriter = {
        handleEvent: vi.fn() as unknown as HandleEventFn,
      };

      recorder.subscribe(mockWriter);
      recorder.subscribe(mockWriter); // Subscribe the same writer again
      recorder.info?.log("Test message");

      expect(mockWriter.handleEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe("task logging", () => {
    test("logs task with status running", () => {
      recorder.info?.log({
        type: "task",
        status: TaskStatus.Running,
        id: "task1",
        message: "Starting task",
      });

      const logs = recorder.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual({
        level: LogLevel.Info,
        time: 1000000000000,
        kind: "body",
        payload: [
          {
            type: "task",
            status: TaskStatus.Running,
            id: "task1",
            message: "Starting task",
          },
        ],
      });
    });

    test("logs task with status success", () => {
      recorder.info?.log({
        type: "task",
        status: TaskStatus.Success,
        id: "task1",
        message: "Task completed",
      });

      const logs = recorder.getLogs();
      expect(logs[0]).toMatchObject({
        level: LogLevel.Info,
        kind: "body",
        payload: [
          expect.objectContaining({
            type: "task",
            status: TaskStatus.Success,
            id: "task1",
            message: "Task completed",
          }),
        ],
      });
    });

    test("logs task with status fail", () => {
      recorder.info?.log({
        type: "task",
        status: TaskStatus.Fail,
        id: "task1",
        message: "Task failed",
      });

      const logs = recorder.getLogs();
      expect(logs[0]).toMatchObject({
        level: LogLevel.Info,
        kind: "body",
        payload: [
          expect.objectContaining({
            type: "task",
            status: TaskStatus.Fail,
            id: "task1",
            message: "Task failed",
          }),
        ],
      });
    });
  });

  describe("logging", () => {
    test("logs simple messages", () => {
      recorder.info?.log("Info message");

      const logs = recorder.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual({
        level: LogLevel.Info,
        time: 1000000000000,
        kind: "body",
        payload: [{ message: "Info message" }],
      });
    });

    test("logs heading messages", () => {
      recorder.info?.heading.log("Info header");

      const logs = recorder.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toEqual({
        level: LogLevel.Info,
        time: 1000000000000,
        kind: "heading",
        payload: [{ message: "Info header" }],
      });
    });

    test("doesn't log debug messages when level is Info", () => {
      recorder.level = LogLevel.Info;
      // Debug should be null when level is Info (since Info > Debug)
      expect(recorder.debug).toBeNull();
    });

    test("logs debug messages when level is Debug", () => {
      // Set level to Debug
      recorder.level = LogLevel.Debug;

      // Ensure debug object exists when level is Debug
      expect(recorder.debug).not.toBeNull();

      // Perform logging
      if (recorder.debug) {
        recorder.debug.log("Debug message");

        // Get debug logs by passing the debug level filter
        const logs = recorder.getLogs(LogLevel.Debug);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
          level: LogLevel.Debug,
          kind: "body",
          payload: [{ message: "Debug message" }],
        });
      }
    });

    test("logs objects with additional properties", () => {
      recorder.info?.log({
        message: "Custom message",
        customProp: "custom value",
      });

      const logs = recorder.getLogs();
      expect(logs[0]).toEqual({
        level: LogLevel.Info,
        time: 1000000000000,
        kind: "body",
        payload: [
          {
            message: "Custom message",
            customProp: "custom value",
          },
        ],
      });
    });

    test("filters logs by level", () => {
      // Set recorder to Debug level so debug logging works
      recorder.level = LogLevel.Debug;

      // Ensure debug is not null
      expect(recorder.debug).not.toBeNull();

      // Add logs at different levels
      if (recorder.debug) {
        recorder.debug.log("Debug message");
        recorder.info?.log("Info message");

        // We should have one info log when filtered to info level
        expect(recorder.getLogs(LogLevel.Info)).toHaveLength(1);

        // We should have both logs when filtered to include Debug level
        const allLogs = recorder.getLogs(LogLevel.Debug);
        expect(allLogs).toHaveLength(2);

        // Verify the logs are at the expected levels
        const debugLogs = allLogs.filter((log) => log.level === LogLevel.Debug);
        const infoLogs = allLogs.filter((log) => log.level === LogLevel.Info);
        expect(debugLogs).toHaveLength(1);
        expect(infoLogs).toHaveLength(1);
      }
    });
  });

  describe("event publishing", () => {
    test("publishes events to multiple writers", () => {
      const mockWriter1: RecorderWriter = {
        handleEvent: vi.fn() as unknown as HandleEventFn,
      };
      const mockWriter2: RecorderWriter = {
        handleEvent: vi.fn() as unknown as HandleEventFn,
      };

      recorder.subscribe(mockWriter1);
      recorder.subscribe(mockWriter2);
      recorder.info?.log("Test message");

      expect(mockWriter1.handleEvent).toHaveBeenCalledTimes(1);
      expect(mockWriter2.handleEvent).toHaveBeenCalledTimes(1);
    });
  });
});
