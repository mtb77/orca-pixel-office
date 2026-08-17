const TABLE: Record<string, Record<string, string>> = {
  codex: { shell: 'Bash', exec_command: 'Bash', apply_patch: 'Edit', read_file: 'Read' },
  claude: { Bash: 'Bash', Edit: 'Edit', Write: 'Edit', Read: 'Read', Glob: 'Read', Grep: 'Read' },
  antigravity: { run_command: 'Bash', write_file: 'Edit', read_file: 'Read' }
};
export function canonicalToolName(agentType: string | undefined, raw: string): string {
  return TABLE[agentType?.toLowerCase() ?? '']?.[raw] ?? raw;
}
export function isRecognizedTool(agentType: string | undefined, raw: string): boolean {
  return TABLE[agentType?.toLowerCase() ?? '']?.[raw] !== undefined;
}
