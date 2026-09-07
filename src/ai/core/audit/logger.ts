import type { AiActivityEvent, AiActivitySink } from "./types";
import { sanitizeAuditMetadata } from "./fingerprint";

export async function logAiActivity(sink: AiActivitySink, event: AiActivityEvent) {
  await sink.write({ ...event, metadata: sanitizeAuditMetadata(event.metadata ?? {}) });
}

export class MemoryAiActivitySink implements AiActivitySink {
  readonly events: AiActivityEvent[] = [];
  async write(event: AiActivityEvent) { this.events.push(event); }
}

