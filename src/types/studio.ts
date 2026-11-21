export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled"
  | "awaiting_approval";

export type AgentStatus = "active" | "idle" | "busy" | "paused";

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  description: string;
  assignedModel: string;
  status: AgentStatus;
  completedTasks: number;
}

export interface StudioTask {
  id: string;
  title: string;
  projectName: string;
  agentName: string;
  status: TaskStatus;
  progress: number;
  priority: "high" | "medium" | "low";
  updatedAt: string;
}

export interface StudioProject {
  id: string;
  name: string;
  tagline: string;
  status: "active" | "draft" | "archived";
  artifactsCount: number;
  activeAgents: number;
  lastActivity: string;
  memoryKeys: string[];
}

export interface ExecutionStep {
  stepNumber: number;
  agentName: string;
  action: string;
  dependsOn: string;
  estimatedOutput: string;
}

export interface CommandMessage {
  id: string;
  sender: "user" | "orchestrator";
  timestamp: string;
  content: string;
  mode?: "manual" | "autonomous";
  plan?: ExecutionStep[];
  requiresApproval?: boolean;
  approved?: boolean;
}

export interface UserProfile {
  id: string;
  email: string;
  fullName: string | null;
  timezone: string;
  themePreference: "dark" | "light";
}
export type MemoryScope = "user" | "project" | "agent" | "task";

export interface DbProject {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  system_instructions: string | null;
  default_mode: "manual" | "autonomous";
  status: "active" | "draft" | "archived";
  created_at: string;
  updated_at: string;
}

export interface DbMemory {
  id: string;
  user_id: string;
  project_id: string | null;
  agent_id: string | null;
  task_id: string | null;
  scope: MemoryScope;
  memory_key: string;
  content: string;
  importance: number;
  created_at: string;
  updated_at: string;
}
