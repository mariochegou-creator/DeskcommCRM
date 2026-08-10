import type { EventHandler } from "@/lib/event-log/dispatcher";
import {
  MEETING_ANALYSIS_CONSUMER_KEY,
  analyzeMeeting,
} from "@/workers/meeting-analysis-worker";

export const meetingAnalysisHandler: EventHandler = {
  key: MEETING_ANALYSIS_CONSUMER_KEY,
  events: ["meeting.analysis_requested"],
  handle: analyzeMeeting,
};
