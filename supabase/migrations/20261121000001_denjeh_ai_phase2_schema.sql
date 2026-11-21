-- ============================================================================
-- DENJEH AI — PHASE 2 DATABASE SCHEMA & ROW LEVEL SECURITY (POSTGRESQL)
-- ============================================================================

create extension if not exists "pgcrypto";

-- Helper function for updated_at timestamp
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- 1. PROFILES
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  timezone text not null default 'Asia/Jakarta',
  theme_preference text not null default 'dark' check (theme_preference in ('dark', 'light')),
  monthly_ai_budget_usd numeric(10, 4) not null default 0.0000,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_profiles_email on public.profiles(email);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Auto-create profile when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, timezone)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email, ''), '@', 1)),
    'Asia/Jakarta'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 2. AI PROVIDERS & AI MODELS
create table if not exists public.ai_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_key text not null, -- e.g. 'gemini', 'groq', 'custom'
  display_name text not null,
  base_url text,
  encrypted_api_key text, -- Encrypted server-side, never returned raw to client
  key_last4 text,
  is_enabled boolean not null default true,
  is_free_tier boolean not null default true,
  rate_limit_rpm integer not null default 15,
  priority_order integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, provider_key)
);

create index if not exists idx_ai_providers_user_id on public.ai_providers(user_id);

create trigger trg_ai_providers_updated_at
before update on public.ai_providers
for each row execute function public.set_updated_at();

create table if not exists public.ai_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.ai_providers(id) on delete cascade,
  model_identifier text not null, -- e.g. 'gemini-2.5-flash', 'llama-3.3-70b-versatile'
  display_name text not null,
  capability text not null default 'text', -- 'text', 'vision', 'code', 'structured_json'
  cost_per_1k_input_usd numeric(10, 6) not null default 0.000000,
  cost_per_1k_output_usd numeric(10, 6) not null default 0.000000,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_ai_models_user_id on public.ai_models(user_id);
create index if not exists idx_ai_models_provider_id on public.ai_models(provider_id);

create trigger trg_ai_models_updated_at
before update on public.ai_models
for each row execute function public.set_updated_at();

-- 3. PROJECTS
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  system_instructions text,
  default_mode text not null default 'manual' check (default_mode in ('manual', 'autonomous')),
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, slug)
);

create index if not exists idx_projects_user_id on public.projects(user_id);
create index if not exists idx_projects_status on public.projects(status);

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- 4. AGENTS & AGENT SKILLS
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  agent_code text not null, -- 'orchestrator', 'idea', 'research', 'story', 'character', 'visual', 'video', 'marketing', 'publishing', 'quality'
  name text not null,
  role text not null,
  description text,
  system_instructions text not null,
  assigned_model_id uuid references public.ai_models(id) on delete set null,
  tool_permissions jsonb not null default '[]'::jsonb,
  status text not null default 'idle' check (status in ('active', 'idle', 'busy', 'paused')),
  max_tokens_per_run integer not null default 4096,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, agent_code)
);

create index if not exists idx_agents_user_id on public.agents(user_id);

create trigger trg_agents_updated_at
before update on public.agents
for each row execute function public.set_updated_at();

create table if not exists public.agent_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  skill_name text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  is_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_agent_skills_agent_id on public.agent_skills(agent_id);

-- 5. WORKFLOWS, WORKFLOW STEPS & WORKFLOW RUNS
create table if not exists public.workflows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  name text not null,
  description text,
  is_template boolean not null default false,
  is_enabled boolean not null default true,
  requires_approval boolean not null default true,
  max_concurrency integer not null default 2 check (max_concurrency between 1 and 2),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_workflows_user_id on public.workflows(user_id);
create index if not exists idx_workflows_project_id on public.workflows(project_id);

create trigger trg_workflows_updated_at
before update on public.workflows
for each row execute function public.set_updated_at();

create table if not exists public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete restrict,
  step_order integer not null,
  step_title text not null,
  instruction_template text not null,
  condition_expr text,
  created_at timestamptz not null default timezone('utc', now()),
  unique (workflow_id, step_order)
);

create index if not exists idx_workflow_steps_workflow_id on public.workflow_steps(workflow_id);

create table if not exists public.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  trigger_mode text not null default 'manual' check (trigger_mode in ('manual', 'autonomous', 'scheduled')),
  status text not null default 'pending' check (status in ('pending', 'awaiting_approval', 'running', 'completed', 'failed', 'cancelled')),
  plan_json jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_workflow_runs_user_id on public.workflow_runs(user_id);
create index if not exists idx_workflow_runs_status on public.workflow_runs(status);

create trigger trg_workflow_runs_updated_at
before update on public.workflow_runs
for each row execute function public.set_updated_at();

-- 6. TASKS & TASK DEPENDENCIES
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  workflow_run_id uuid references public.workflow_runs(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  idempotency_key text not null,
  title text not null,
  input_payload jsonb not null default '{}'::jsonb,
  checkpoint_state jsonb not null default '{}'::jsonb,
  output_payload jsonb,
  error_message text,
  status text not null default 'pending' check (
    status in ('pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'cancelled', 'awaiting_approval')
  ),
  priority integer not null default 5 check (priority between 1 and 10),
  progress integer not null default 0 check (progress between 0 and 100),
  retry_count integer not null default 0,
  max_retries integer not null default 3,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, idempotency_key)
);

create index if not exists idx_tasks_user_id on public.tasks(user_id);
create index if not exists idx_tasks_status on public.tasks(status);
create index if not exists idx_tasks_workflow_run_id on public.tasks(workflow_run_id);

create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute function public.set_updated_at();

create table if not exists public.task_dependencies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  unique (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create index if not exists idx_task_dependencies_task_id on public.task_dependencies(task_id);

-- 7. ARTIFACTS & PROMPT VERSIONS
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid references public.tasks(id) on delete set null,
  artifact_type text not null, -- 'story', 'character_sheet', 'storyboard', 'image_prompt', 'video_prompt', 'social_copy', 'uploaded_file', 'generated_image', 'generated_video'
  title text not null,
  content_text text,
  metadata jsonb not null default '{}'::jsonb,
  r2_object_key text,
  file_url text,
  mime_type text,
  file_size_bytes bigint,
  version integer not null default 1,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_artifacts_user_id on public.artifacts(user_id);
create index if not exists idx_artifacts_project_id on public.artifacts(project_id);

create trigger trg_artifacts_updated_at
before update on public.artifacts
for each row execute function public.set_updated_at();

create table if not exists public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  version_number integer not null default 1,
  prompt_text text not null,
  notes text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_prompt_versions_project_id on public.prompt_versions(project_id);

-- 8. MEMORIES (USER, PROJECT, AGENT, TASK)
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  scope text not null check (scope in ('user', 'project', 'agent', 'task')),
  memory_key text not null,
  content text not null,
  importance integer not null default 5 check (importance between 1 and 10),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_memories_user_id on public.memories(user_id);
create index if not exists idx_memories_project_id on public.memories(project_id);
create index if not exists idx_memories_scope on public.memories(scope);

create trigger trg_memories_updated_at
before update on public.memories
for each row execute function public.set_updated_at();

-- 9. SCHEDULES, USAGE LOGS & NOTIFICATIONS
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  cron_expression text not null,
  timezone text not null default 'Asia/Jakarta',
  active_days jsonb not null default '["mon","tue","wed","thu","fri","sat","sun"]'::jsonb,
  max_runs_per_day integer not null default 5,
  max_ai_cost_usd numeric(10, 4) not null default 0.0000,
  requires_approval boolean not null default true,
  is_active boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_schedules_user_id on public.schedules(user_id);
create index if not exists idx_schedules_next_run_at on public.schedules(next_run_at);

create trigger trg_schedules_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  provider_key text not null,
  model_identifier text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost_usd numeric(10, 6) not null default 0.000000,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_usage_logs_user_id on public.usage_logs(user_id);
create index if not exists idx_usage_logs_created_at on public.usage_logs(created_at);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  level text not null default 'info' check (level in ('info', 'warning', 'error', 'approval')),
  is_read boolean not null default false,
  action_url text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_notifications_user_id on public.notifications(user_id);

-- 10. FUTURE PUBLISHING TABLES (PHASE 11)
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook_page', 'instagram_professional', 'youtube_channel')),
  account_external_id text not null,
  account_name text not null,
  permissions jsonb not null default '[]'::jsonb,
  is_connected boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_social_accounts_user_id on public.social_accounts(user_id);

create table if not exists public.social_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_social_tokens_user_id on public.social_tokens(user_id);

create table if not exists public.content_calendar (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  artifact_id uuid references public.artifacts(id) on delete set null,
  title text not null,
  caption text,
  hashtags text,
  platform text not null check (platform in ('facebook_page', 'instagram_professional', 'youtube_channel')),
  status text not null default 'idea' check (status in ('idea', 'draft', 'approved', 'scheduled', 'published')),
  scheduled_for timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_content_calendar_user_id on public.content_calendar(user_id);
create index if not exists idx_content_calendar_scheduled_for on public.content_calendar(scheduled_for);

create table if not exists public.publication_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  content_calendar_id uuid not null references public.content_calendar(id) on delete cascade,
  social_account_id uuid not null references public.social_accounts(id) on delete cascade,
  approval_status text not null default 'pending_approval' check (approval_status in ('pending_approval', 'approved', 'rejected')),
  job_status text not null default 'queued' check (job_status in ('queued', 'processing', 'published', 'failed')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_publication_jobs_user_id on public.publication_jobs(user_id);

create table if not exists public.publication_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  publication_job_id uuid not null references public.publication_jobs(id) on delete cascade,
  external_post_id text,
  published_url text,
  response_summary jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_publication_results_user_id on public.publication_results(user_id);

create table if not exists public.platform_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  require_publish_approval boolean not null default true,
  default_timezone text not null default 'Asia/Jakarta',
  settings_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id)
);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY (RLS) ON ALL TABLES
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.ai_providers enable row level security;
alter table public.ai_models enable row level security;
alter table public.projects enable row level security;
alter table public.agents enable row level security;
alter table public.agent_skills enable row level security;
alter table public.workflows enable row level security;
alter table public.workflow_steps enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.tasks enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.artifacts enable row level security;
alter table public.prompt_versions enable row level security;
alter table public.memories enable row level security;
alter table public.schedules enable row level security;
alter table public.usage_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.social_accounts enable row level security;
alter table public.social_tokens enable row level security;
alter table public.content_calendar enable row level security;
alter table public.publication_jobs enable row level security;
alter table public.publication_results enable row level security;
alter table public.platform_settings enable row level security;

-- Profiles RLS
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);

-- User-owned tables RLS macro helper policies
create policy "ai_providers_own" on public.ai_providers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_models_own" on public.ai_models for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "projects_own" on public.projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agents_own" on public.agents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "agent_skills_own" on public.agent_skills for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workflows_own" on public.workflows for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workflow_steps_own" on public.workflow_steps for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "workflow_runs_own" on public.workflow_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "tasks_own" on public.tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "task_dependencies_own" on public.task_dependencies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "artifacts_own" on public.artifacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "prompt_versions_own" on public.prompt_versions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "memories_own" on public.memories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "schedules_own" on public.schedules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "usage_logs_own" on public.usage_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications_own" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "social_accounts_own" on public.social_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "social_tokens_own" on public.social_tokens for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "content_calendar_own" on public.content_calendar for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "publication_jobs_own" on public.publication_jobs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "publication_results_own" on public.publication_results for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "platform_settings_own" on public.platform_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
