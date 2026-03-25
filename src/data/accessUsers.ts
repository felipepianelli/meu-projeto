import type { AccessUser } from '../types'

export const defaultAccessUsers: AccessUser[] = [
  {
    id: 'felipe-admin-plus',
    name: 'Felipe Souza',
    username: 'felipe.souza',
    password: 'Felipe@2026',
    role: 'admin_plus',
    description:
      'Pode visualizar, associar audiencia, incluir pessoas, remover pessoas e administrar usuarios do prototipo.',
  },
  {
    id: 'admin-operacional',
    name: 'Admin Operacional',
    username: 'admin.operacional',
    password: 'Admin@2026',
    role: 'admin',
    description:
      'Pode gerenciar missoes, times e pessoas, mas nao acessa a aba de usuarios.',
  },
  {
    id: 'viewer-basico',
    name: 'Visualizacao Basica',
    username: 'visual.basico',
    password: 'Visual@2026',
    role: 'viewer',
    description: 'Pode apenas visualizar telas e baixar arquivos XLS.',
  },
]
