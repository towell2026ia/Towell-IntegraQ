// Server-side configuration for the two independent quality agents.
export const qualityAgentBaseURL = "https://api.openai.com/v1";
export const qualityAgentModel = "gpt-6-luna";
export const reasoningEffort = {
  root2cause: "low",
  managementReview: "medium",
} as const;
