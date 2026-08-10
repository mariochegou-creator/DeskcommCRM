import type { EventHandler } from "@/lib/event-log/dispatcher";
import {
  CALL_ANALYSIS_CONSUMER_KEY,
  analyzeCallRecording,
} from "@/workers/call-analysis-worker";

export const callAnalysisHandler: EventHandler = {
  key: CALL_ANALYSIS_CONSUMER_KEY,
  events: ["call.transcribe_requested"],
  handle: analyzeCallRecording,
};
