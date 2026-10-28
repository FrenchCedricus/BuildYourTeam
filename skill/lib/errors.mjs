// Erreurs métier : un code stable (pour --json), un message en français et une piste de solution.
export class BytError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.name = 'BytError';
    this.code = code;
    this.hint = hint;
  }
}

export const errors = {
  usage: (usage) => new BytError('USAGE', 'Arguments manquants ou invalides.', `Usage : ${usage}`),
  unknownCommand: (cmd) =>
    new BytError('UNKNOWN_COMMAND', `Commande inconnue : « ${cmd} ».`, 'Tapez « byt help » pour voir les commandes disponibles.'),
  teamNotInstalled: (name) =>
    new BytError('TEAM_NOT_INSTALLED', `La team « ${name} » n'est pas installée.`, `Installez-la avec : /byt install ${name}`),
  teamNotInRegistry: (name) =>
    new BytError('TEAM_NOT_IN_REGISTRY', `La team « ${name} » est introuvable dans le registry.`, 'Cherchez une team avec : /byt search <mot>'),
  teamExists: (name, scope) =>
    new BytError(
      'TEAM_EXISTS',
      `La team « ${name} » existe déjà (${scopeLabel(scope)}).`,
      `Utilisez /byt update ${name}, ou ajoutez --force pour la remplacer.`
    ),
  agentNotFound: (team, agent) =>
    new BytError('AGENT_NOT_FOUND', `L'agent « ${agent} » n'existe pas dans la team « ${team} ».`, `Voir ses agents : /byt info ${team}`),
  invalidName: (kind, name) =>
    new BytError(
      'INVALID_NAME',
      `Nom de ${kind} invalide : « ${name} ».`,
      'Utilisez le kebab-case : lettres minuscules, chiffres et tirets (ex. « mon-agent »).'
    ),
  invalidJson: (what, detail) => new BytError('INVALID_JSON', `JSON invalide (${what}) : ${detail}`),
  conflictingScopes: () =>
    new BytError('CONFLICTING_SCOPES', 'Les options --project et --global ne peuvent pas être utilisées ensemble.'),
  projectScopeUnavailable: () =>
    new BytError(
      'PROJECT_SCOPE_UNAVAILABLE',
      'Le mode projet est indisponible : le dossier courant est votre dossier personnel.',
      'Placez-vous dans le dossier d\'un projet, ou utilisez --global.'
    ),
};

export function scopeLabel(scope) {
  return scope === 'project' ? 'projet' : 'global';
}
