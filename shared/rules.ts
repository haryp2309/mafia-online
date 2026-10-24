import type { Player, RoleDef, Team } from './types';

export interface SetupInput {
  names: string[];
  roles: RoleDef[];
  roleCounts: Record<string, number>;
}

export function validateSetup({ names, roles, roleCounts }: SetupInput): string[] {
  const errors: string[] = [];
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length < 3) errors.push('Add at least 3 players.');
  const seen = new Set<string>();
  for (const n of cleaned) {
    const key = n.toLowerCase();
    if (seen.has(key)) errors.push(`"${n}" is listed twice.`);
    seen.add(key);
  }

  const roleIds = new Set<string>();
  for (const r of roles) {
    if (!r.name.trim()) errors.push('Every role needs a name.');
    if (roleIds.has(r.id)) errors.push(`Duplicate role id "${r.id}".`);
    roleIds.add(r.id);
  }

  let total = 0;
  let mafia = 0;
  for (const r of roles) {
    const c = roleCounts[r.id] ?? 0;
    if (!Number.isInteger(c) || c < 0) errors.push(`Invalid count for ${r.name}.`);
    total += c;
    if (r.team === 'mafia') mafia += c;
  }
  if (total !== cleaned.length) {
    errors.push(`Role counts add up to ${total}, but there are ${cleaned.length} players.`);
  }
  if (mafia < 1) errors.push('There must be at least one mafia.');
  if (cleaned.length > 0 && mafia >= cleaned.length - mafia) {
    errors.push('Mafia must be fewer than everyone else, or they win immediately.');
  }
  return errors;
}

export function teamOf(player: Player, roles: RoleDef[]): Team | null {
  return roles.find((r) => r.id === player.roleId)?.team ?? null;
}

/** Town wins when no mafia are left; mafia win when they equal or outnumber everyone else. */
export function checkWinner(players: Player[], roles: RoleDef[]): Team | null {
  const alive = players.filter((p) => p.alive);
  const mafia = alive.filter((p) => teamOf(p, roles) === 'mafia').length;
  const others = alive.length - mafia;
  if (mafia === 0) return 'town';
  if (mafia >= others) return 'mafia';
  return null;
}
