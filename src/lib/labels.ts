import type { ProfileId, RoleId } from "./types";

export const ROLE_IDS: RoleId[] = [
  "intake",
  "reasoning",
  "writer",
  "architect",
  "contracts",
  "tasks",
];

export const ROLE_LABELS: Record<RoleId, string> = {
  intake: "Intake / Clarify",
  reasoning: "Reasoning",
  writer: "Writer",
  architect: "Architect",
  contracts: "Contracts",
  tasks: "Tasks",
};

export const ROLE_SHORT_LABELS: Record<RoleId, string> = {
  intake: "Intake",
  reasoning: "Reasoning",
  writer: "Writer",
  architect: "Architect",
  contracts: "Contracts",
  tasks: "Tasks",
};

export const ROLE_HINTS: Record<RoleId, string> = {
  intake: "Questions asked before the run starts.",
  reasoning: "Discovery brief: problem, users, scope, assumptions. Frontier model.",
  writer: "Product requirements: vision, journeys, features, metrics.",
  architect: "Stack, frontend, backend, data, deployment.",
  contracts: "Entities, relationships, endpoint contracts.",
  tasks: "Task list an AI coding agent can execute.",
};

export const PROFILE_LABELS: Record<ProfileId, string> = {
  hemat: "Hemat",
  combo: "Combo",
  maksimal: "Maksimal",
};
