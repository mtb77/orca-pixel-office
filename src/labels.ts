import type { Placement } from './types.js';

const KNOWN_AGENT_TYPES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  antigravity: 'Antigravity'
};

export function formatAgentType(agentType?: string): string {
  if (!agentType) return 'Agent';
  const trimmed = agentType.trim();
  if (!trimmed) return 'Agent';
  return KNOWN_AGENT_TYPES[trimmed.toLowerCase()] ?? trimmed;
}

export function formatBranch(branch?: string): string | undefined {
  if (!branch) return undefined;
  let cleaned = branch.trim();
  if (!cleaned) return undefined;
  if (cleaned.startsWith('refs/heads/')) {
    cleaned = cleaned.slice('refs/heads/'.length);
  } else if (cleaned.startsWith('refs/remotes/')) {
    cleaned = cleaned.slice('refs/remotes/'.length);
  } else if (cleaned.startsWith('refs/tags/')) {
    cleaned = cleaned.slice('refs/tags/'.length);
  }
  cleaned = cleaned.trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function folderFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const segments = path.trim().split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : undefined;
}

export function formatRoomName(placement: Placement, repoId?: string): string {
  const repo = placement.repo?.trim();
  if (repo) return repo;
  const fromPath = folderFromPath(placement.path);
  if (fromPath) return fromPath;
  const id = repoId?.trim();
  if (id && !id.startsWith('folder-workspace:')) return id;
  return 'workspace';
}

export function formatDisplayName(agentType?: string, branch?: string): string {
  const formattedType = formatAgentType(agentType);
  const formattedBranch = formatBranch(branch);
  return formattedBranch ? `${formattedType} / ${formattedBranch}` : formattedType;
}
