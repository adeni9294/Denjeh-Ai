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