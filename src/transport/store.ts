import type { AgentEvent } from "../turns/events.js";
import type { StreamResult } from "../providers/helpers.js";

export interface SeqEvent {
  seq: number;
  event: AgentEvent;
}

export interface SessionStore {
  append(sessionId: string, entry: SeqEvent): void;
  read(sessionId: string, afterSeq?: number): SeqEvent[];
  setResult(sessionId: string, result: StreamResult): void;
  getResult(sessionId: string): StreamResult | null;
  delete(sessionId: string): void;
}

interface SessionData {
  events: SeqEvent[];
  result: StreamResult | null;
}

export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionData>();

  private getOrCreate(sessionId: string): SessionData {
    let data = this.sessions.get(sessionId);
    if (!data) {
      data = { events: [], result: null };
      this.sessions.set(sessionId, data);
    }
    return data;
  }

  append(sessionId: string, entry: SeqEvent): void {
    this.getOrCreate(sessionId).events.push(entry);
  }

  read(sessionId: string, afterSeq?: number): SeqEvent[] {
    const data = this.sessions.get(sessionId);
    if (!data) return [];
    const events = afterSeq != null ? data.events.filter((e) => e.seq > afterSeq) : data.events;
    return events.map((e) => ({ ...e }));
  }

  setResult(sessionId: string, result: StreamResult): void {
    this.getOrCreate(sessionId).result = result;
  }

  getResult(sessionId: string): StreamResult | null {
    return this.sessions.get(sessionId)?.result ?? null;
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
