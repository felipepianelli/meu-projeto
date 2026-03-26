import { mockConnectionStatus, mockDashboardData } from '../data/mockSkoreApi'
import { missionAudienceCatalog } from '../data/missionAudienceCatalog'
import collaborators from '../data/collaborators.json'
import { io, type Socket } from 'socket.io-client'
import type {
  CollaboratorRecord,
  CollaboratorMissionMatrix,
  ConnectionStatus,
  DashboardData,
  MissionAudienceMember,
  MissionReportRow,
  MissionAudienceSummary,
  SyncEvent,
  TeamMember,
} from '../types'

const LOCAL_STORAGE_TOKEN_KEY = 'skore_manager_token'
const LOCAL_ASSIGNMENTS_KEY = 'skore_manager_team_assignments'
const LOCAL_MISSION_AUDIENCE_KEY = 'skore_manager_mission_audience_overrides'
const LOCAL_COLLABORATORS_KEY = 'skore_manager_collaborators_db'
const LOCAL_COLLABORATORS_SYNC_KEY = 'skore_manager_collaborators_synced_at'
const JSL_GRU_FILTER = 'jsl/gru'
const collaboratorsApiUrl =
  import.meta.env.VITE_COLLABORATORS_API_URL?.trim() ||
  'https://meu-backend-2p74.onrender.com'
const embeddedCollaboratorRows = collaborators as CollaboratorRecord[]

function getConfiguredBaseUrl() {
  return import.meta.env.VITE_SKORE_API_URL?.trim() ?? ''
}

function getCollaboratorsDb() {
  const initialRows = hasCollaboratorsBackend() ? [] : embeddedCollaboratorRows

  if (typeof window === 'undefined') {
    return initialRows
  }

  const raw = window.localStorage.getItem(LOCAL_COLLABORATORS_KEY)

  if (!raw) {
    if (initialRows.length) {
      window.localStorage.setItem(
        LOCAL_COLLABORATORS_KEY,
        JSON.stringify(initialRows),
      )
    }

    return initialRows
  }

  try {
    return JSON.parse(raw) as CollaboratorRecord[]
  } catch {
    return initialRows
  }
}

function persistCollaboratorsDb(collaboratorsDb: CollaboratorRecord[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    LOCAL_COLLABORATORS_KEY,
    JSON.stringify(collaboratorsDb),
  )
  window.localStorage.setItem(LOCAL_COLLABORATORS_SYNC_KEY, new Date().toISOString())
}

function getCollaboratorContext() {
  const collaboratorRows = getCollaboratorsDb()

  return {
    collaboratorRows,
    collaboratorNamesByMatricula: new Map(
      collaboratorRows.map((item) => [item.matricula, item.nome]),
    ),
    allowedMatriculas: new Set(collaboratorRows.map((item) => item.matricula)),
    totalCollaborators: collaboratorRows.length,
  }
}

function getTeamsUrl() {
  return import.meta.env.VITE_SKORE_TEAMS_URL?.trim() || 'https://user.skore.ai/v1/teams'
}

function hasCollaboratorsBackend() {
  return Boolean(collaboratorsApiUrl)
}

type CollaboratorsApiResponse = {
  items: CollaboratorRecord[]
  total: number
  updatedAt: string
}

function getTeamUsersUrl(teamId: number) {
  return `${getTeamsUrl()}/${teamId}/users`
}

function getConfiguredToken() {
  const envToken = import.meta.env.VITE_SKORE_API_TOKEN?.trim()

  if (envToken) {
    return envToken
  }

  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY) ?? ''
}

function getAuthHeaders(options?: { rawToken?: boolean }) {
  const token = getConfiguredToken()

  const headers: Record<string, string> = {}

  if (token) {
    headers.Authorization = options?.rawToken ? token : `Bearer ${token}`
  }

  return headers
}

async function readJson<T>(input: string, init?: RequestInit) {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(`Falha na requisicao (${response.status})`)
  }

  return (await response.json()) as T
}

function normalizeDashboardPayload(payload: Partial<DashboardData>): DashboardData {
  return {
    collaboratorCount: payload.collaboratorCount ?? mockDashboardData.collaboratorCount,
    activeMissionCount: payload.activeMissionCount ?? mockDashboardData.activeMissionCount,
    overdueTaskCount: payload.overdueTaskCount ?? mockDashboardData.overdueTaskCount,
    departments: payload.departments ?? mockDashboardData.departments,
    missionStatus: payload.missionStatus ?? mockDashboardData.missionStatus,
    syncEvents: payload.syncEvents ?? mockDashboardData.syncEvents,
    lastSyncLabel: payload.lastSyncLabel ?? 'Sincronizado agora',
    teams: payload.teams ?? mockDashboardData.teams,
    users: payload.users ?? mockDashboardData.users,
    userEnrollments: payload.userEnrollments ?? mockDashboardData.userEnrollments,
  }
}

export async function fetchDashboardData(signal?: AbortSignal): Promise<DashboardData> {
  const baseUrl = getConfiguredBaseUrl()
  const { totalCollaborators } = getCollaboratorContext()

  if (!baseUrl && !hasToken()) {
    await wait(500)
    return normalizeDashboardPayload({
      ...mockDashboardData,
      collaboratorCount: totalCollaborators,
      activeMissionCount: missionAudienceCatalog.length,
      lastSyncLabel: `Sincronizado em ${formatDateLabel(new Date().toISOString())}`,
      syncEvents: [
        {
          id: 'collaborators-online',
          title: 'Colaboradores do banco online',
          detail: `${totalCollaborators} colaboradores carregados a partir da base online central.`,
          time: 'Agora',
          state: 'success',
        },
        {
          id: 'missions-catalog',
          title: 'Missoes mapeadas localmente',
          detail: `${missionAudienceCatalog.length} missoes no catalogo atual do sistema.`,
          time: 'Agora',
          state: 'info',
        },
      ],
    })
  }

  try {
    if (baseUrl) {
      const payload = await readJson<Partial<DashboardData>>(`${baseUrl}/overview`, {
        signal,
        headers: {
          Accept: 'application/json',
          ...getAuthHeaders(),
        },
      })

      return normalizeDashboardPayload(payload)
    }

    const teamsResult = await Promise.allSettled([
      readJson<SkoreTeamsResponse>(getTeamsUrl(), {
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
      }),
    ])

    const teamsPayload =
      teamsResult[0].status === 'fulfilled' ? teamsResult[0].value : undefined
    const filteredTeams =
      teamsPayload?.items.filter((team) => includesJslGru(team.name)) ?? []
    const users = await fetchRecentMissionUsers(signal)
    const teams = filteredTeams.map((team) => mapTeam(team)) ?? mockDashboardData.teams
    const overviewMetrics = await fetchMissionOverviewMetrics(signal)
    const userEnrollments = mockDashboardData.userEnrollments

    const syncEvents: SyncEvent[] = [
      {
        id: 'users-sync',
        title: 'Usuarios por time sob demanda',
        detail:
          'Os membros completos de cada time sao carregados apenas quando voce solicitar, para evitar travamentos no painel.',
        time: 'Agora',
        state: 'info',
      },
      {
        id: 'teams-sync',
        title: teamsPayload ? 'Equipes carregadas' : 'Equipes indisponiveis',
        detail: filteredTeams.length
          ? `${teams.length} equipes com nome contendo JSL/GRU encontradas em user/v1/teams.`
          : 'Nao foi possivel ler as equipes com o token informado.',
        time: 'Agora',
        state: filteredTeams.length ? 'success' : 'warning',
      },
      {
        id: 'missions-pending',
        title: 'Resumo de missoes calculado',
        detail:
          'O Overview agora usa status reais das missoes mapeadas para montar os graficos principais.',
        time: 'Pendente',
        state: 'info',
      },
    ]

    return normalizeDashboardPayload({
      collaboratorCount: totalCollaborators,
      activeMissionCount: overviewMetrics.activeMissionCount,
      overdueTaskCount: overviewMetrics.notStartedCount,
      teams,
      users: users.slice(0, 10),
      userEnrollments,
      departments: overviewMetrics.missionRates,
      missionStatus: overviewMetrics.missionStatus,
      syncEvents,
      lastSyncLabel: `Sincronizado em ${formatDateLabel(new Date().toISOString())}`,
    })
  } catch {
    return mockDashboardData
  }
}

export async function fetchConnectionStatus(
  signal?: AbortSignal,
): Promise<ConnectionStatus> {
  const baseUrl = getConfiguredBaseUrl()

  if (!baseUrl) {
    await wait(350)
    return mockConnectionStatus
  }

  try {
    const payload = await readJson<Partial<ConnectionStatus>>(`${baseUrl}/health`, {
      signal,
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(),
      },
    })

    return {
      connected: payload.connected ?? true,
      mode: payload.mode === 'api' ? 'api' : 'mock',
      label: payload.label ?? 'API conectada',
    }
  } catch {
    return {
      connected: false,
      mode: 'mock',
      label: 'Falha ao validar API',
    }
  }
}

export async function beginSkoreLogin(): Promise<{ token: string }> {
  await wait(900)

  const token = `mock-skore-token-${Date.now()}`

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token)
  }

  return { token }
}

export function hasConfiguredApi() {
  return Boolean(getConfiguredBaseUrl())
}

export function hasToken() {
  return Boolean(getConfiguredToken())
}

type SkoreTeamApiItem = {
  id: number
  name: string
  usersCount: number
  spacesCount: number
  createdAt: number
  userIds?: number[]
}

type SkoreTeamsResponse = {
  items: SkoreTeamApiItem[]
  total: number
}

type SkoreUserApiItem = {
  id: number
  name: string
  email: string | null
  username: string | null
  role: string
  active?: boolean
  created_at: string
  teams: Array<{
    id: number
    name: string
  }>
}

type SkoreUsersSearchResponse = {
  results: SkoreUserApiItem[]
  continuation?: string
}

type SkoreUserDetailApiItem = {
  id: number
  name: string
  username: string | null
  email: string | null
  role?: string
  created_at?: string
  teams?: Array<{
    id: number
    name: string
  }>
}

type MissionEnrollmentApiItem = {
  user_id: string
  status: 'COMPLETED' | 'IN_PROGRESS'
  completed_at: number | null
  summary?: {
    percentage?: number
  }
}

type MissionEnrollmentsResponse = {
  results: MissionEnrollmentApiItem[]
  offset: string | null
}

function mapTeam(
  team: SkoreTeamApiItem,
) {
  return {
    id: team.id,
    name: team.name,
    usersCount: team.usersCount,
    spacesCount: team.spacesCount,
    createdAtLabel: `Criado em ${formatTimestampLabel(team.createdAt)}`,
    matchedMembersCount: 0,
    matchedMembers: [],
  }
}

let teamMembersCache:
  | Promise<{
      generatedAt: string | null
      teams: Array<{
        id: number
        name: string
        usersCount: number
        members: Array<{
          id: number
          name: string
          username: string | null
        }>
      }>
    }>
  | null = null

let missionOverviewCache:
  | Promise<{
      missionStatus: DashboardData['missionStatus']
      missionRates: DashboardData['departments']
      activeMissionCount: number
      notStartedCount: number
    }>
  | null = null

let collaboratorMatrixCache: Promise<CollaboratorMissionMatrix> | null = null
let collaboratorsSocket: Socket | null = null

function readLocalAssignments() {
  if (typeof window === 'undefined') {
    return {} as Record<string, TeamMember[]>
  }

  const raw = window.localStorage.getItem(LOCAL_ASSIGNMENTS_KEY)

  if (!raw) {
    return {} as Record<string, TeamMember[]>
  }

  try {
    return JSON.parse(raw) as Record<string, TeamMember[]>
  } catch {
    return {} as Record<string, TeamMember[]>
  }
}

function writeLocalAssignments(value: Record<string, TeamMember[]>) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LOCAL_ASSIGNMENTS_KEY, JSON.stringify(value))
}

type MissionAudienceOverride = {
  audience: Array<{
    id: string
    name: string
    type: 'team' | 'user'
  }>
}

function readMissionAudienceOverrides() {
  if (typeof window === 'undefined') {
    return {} as Record<string, MissionAudienceOverride>
  }

  const raw = window.localStorage.getItem(LOCAL_MISSION_AUDIENCE_KEY)

  if (!raw) {
    return {} as Record<string, MissionAudienceOverride>
  }

  try {
    return JSON.parse(raw) as Record<string, MissionAudienceOverride>
  } catch {
    return {} as Record<string, MissionAudienceOverride>
  }
}

function writeMissionAudienceOverrides(value: Record<string, MissionAudienceOverride>) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(LOCAL_MISSION_AUDIENCE_KEY, JSON.stringify(value))
}

function getMissionDefinitionWithOverrides(missionId: string) {
  const mission = missionAudienceCatalog.find((item) => item.id === missionId)

  if (!mission) {
    return null
  }

  const overrides = readMissionAudienceOverrides()
  const override = overrides[missionId]

  if (!override) {
    return mission
  }

  return {
    ...mission,
    audience: override.audience,
  }
}

export async function fetchMembersForTeam(
  teamId: number,
  options?: { refresh?: boolean },
): Promise<TeamMember[]> {
  if (options?.refresh) {
    teamMembersCache = null
  }

  if (!teamMembersCache) {
    teamMembersCache = readJson(new URL('./team-members-cache.json', window.location.href).toString())
  }
  let payload

  try {
    payload = await teamMembersCache
  } catch (error) {
    teamMembersCache = null
    throw error
  }

  const team = payload.teams.find((item) => item.id === teamId)
  const localAssignments = readLocalAssignments()
  const localMembers = localAssignments[String(teamId)] ?? []
  const mergedMembers = [...(team?.members ?? []), ...localMembers]
  const dedupedMembers = mergedMembers.filter(
    (member, index, array) => array.findIndex((item) => item.id === member.id) === index,
  )

  return dedupedMembers
    .map((user) => ({
      id: user.id,
      name:
        getCollaboratorContext().collaboratorNamesByMatricula.get(user.username ?? '') ||
        user.name,
      username: user.username,
      inSpreadsheet: user.username
        ? getCollaboratorContext().allowedMatriculas.has(user.username)
        : false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function clearUsersCache() {
  teamMembersCache = null
  missionOverviewCache = null
  collaboratorMatrixCache = null
}

export function appendLocalMembersToTeam(teamId: number, members: TeamMember[]) {
  const assignments = readLocalAssignments()
  const current = assignments[String(teamId)] ?? []
  const merged = [...current, ...members]

  assignments[String(teamId)] = merged.filter(
    (member, index, array) => array.findIndex((item) => item.id === member.id) === index,
  )

  writeLocalAssignments(assignments)
}

export async function findUsersByMatriculas(
  matriculas: string[],
  signal?: AbortSignal,
): Promise<SkoreUserApiItem[]> {
  const normalized = Array.from(
    new Set(matriculas.map((item) => item.trim()).filter(Boolean)),
  )
  const results: SkoreUserApiItem[] = []
  const batchSize = 8

  for (let index = 0; index < normalized.length; index += batchSize) {
    const batch = normalized.slice(index, index + batchSize)
    const settled = await Promise.allSettled(
      batch.map(async (matricula) => {
        const url = new URL(
          import.meta.env.VITE_SKORE_USERS_URL?.trim() ||
            'https://knowledge.skore.io/workspace/v2/users',
        )
        url.searchParams.set('username__eq', matricula)
        url.searchParams.set('find_exact_match', 'true')
        url.searchParams.set('limit', '2')
        url.searchParams.set('active', 'true')

        const payload = await readJson<SkoreUsersSearchResponse>(url.toString(), {
          signal,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...getAuthHeaders({ rawToken: true }),
          },
        })

        return payload.results[0]
      }),
    )

    settled.forEach((item) => {
      if (item.status === 'fulfilled' && item.value) {
        results.push(item.value)
      }
    })
  }

  return results
}

export async function addUsersToTeam(
  teamId: number,
  userIds: number[],
): Promise<void> {
  const uniqueIds = Array.from(new Set(userIds))

  if (!uniqueIds.length) {
    return
  }

  const response = await fetch(getTeamUsersUrl(teamId), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      user_ids: uniqueIds,
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao atribuir colaboradores (${response.status})`)
  }
}

export async function fetchMissionAudienceMembers(
  missionId: string,
  signal?: AbortSignal,
): Promise<MissionAudienceSummary | null> {
  const mission = getMissionDefinitionWithOverrides(missionId)

  if (!mission) {
    return null
  }

  const teams = mission.audience.filter(
    (item): item is { id: string; name: string; type: 'team' } => item.type === 'team',
  )

  const dedupedMembers = await resolveMissionAudienceMembers(teams)

  const [completedEnrollments, inProgressEnrollments] = await Promise.all([
    fetchMissionEnrollmentsByStatus(mission.id, 'COMPLETED', signal),
    fetchMissionEnrollmentsByStatus(mission.id, 'IN_PROGRESS', signal),
  ])
  const userDetailsCache = new Map<string, Promise<SkoreUserDetailApiItem | null>>()
  const memberMap = new Map<number, TeamMember>(
    dedupedMembers.map((member) => [member.id, member]),
  )

  const enrollmentUserIds = Array.from(
    new Set([...completedEnrollments, ...inProgressEnrollments].map((item) => item.user_id)),
  )
  const unresolvedUserIds = enrollmentUserIds.filter(
    (userId) => !memberMap.has(Number(userId)),
  )
  const resolvedUsers = await Promise.all(
    unresolvedUserIds.map((userId) => fetchUserDetailCached(userId, userDetailsCache, signal)),
  )

  resolvedUsers.forEach((user) => {
    if (!user) {
      return
    }

    memberMap.set(user.id, {
      id: user.id,
      name:
        getCollaboratorContext().collaboratorNamesByMatricula.get(user.username ?? '') ||
        user.name,
      username: user.username,
      inSpreadsheet: user.username
        ? getCollaboratorContext().allowedMatriculas.has(user.username)
        : false,
    })
  })

  const enrollmentByUserId = new Map<string, MissionEnrollmentApiItem>()

  completedEnrollments.forEach((item) => {
    enrollmentByUserId.set(item.user_id, item)
  })

  inProgressEnrollments.forEach((item) => {
    if (!enrollmentByUserId.has(item.user_id)) {
      enrollmentByUserId.set(item.user_id, item)
    }
  })

  const membersWithStatus: MissionAudienceMember[] = Array.from(memberMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((member) => {
    const enrollment = enrollmentByUserId.get(String(member.id))

    if (!enrollment) {
      return {
        ...member,
        missionStatus: 'NOT_STARTED',
        progressPercentage: null,
        completedAtLabel: null,
      }
    }

    return {
      ...member,
      missionStatus: enrollment.status,
      progressPercentage: enrollment.summary?.percentage ?? null,
      completedAtLabel: enrollment.completed_at
        ? formatTimestampLabel(enrollment.completed_at)
        : null,
    }
  })

  return {
    id: mission.id,
    name: mission.name,
    active: mission.active,
    createdAtLabel:
      mission.createdAt > 0
        ? `Criada em ${formatTimestampLabel(mission.createdAt)}`
        : 'Criacao ainda nao mapeada',
    audienceTeams: teams.map((team) => ({
      id: Number(team.id),
      name: team.name,
    })),
    memberCount: membersWithStatus.length,
    members: membersWithStatus,
  }
}

export async function fetchAllMissionReportRows(
  signal?: AbortSignal,
): Promise<MissionReportRow[]> {
  const rows: MissionReportRow[] = []

  for (const mission of missionAudienceCatalog) {
    const summary = await fetchMissionAudienceMembers(mission.id, signal)

    if (!summary) {
      continue
    }

    summary.members.forEach((member) => {
      rows.push({
        matricula: member.username ?? '-',
        name: member.name,
        missionName: summary.name,
        status: member.missionStatus,
        completedAtLabel: member.completedAtLabel,
      })
    })
  }

  return rows.sort((a, b) => {
    if (a.matricula === b.matricula) {
      return a.missionName.localeCompare(b.missionName, 'pt-BR')
    }

    return a.matricula.localeCompare(b.matricula, 'pt-BR')
  })
}

export async function addTeamsToMissionAudience(
  missionId: string,
  teams: Array<{ id: number; name: string }>,
) {
  const teamIds = Array.from(new Set(teams.map((team) => String(team.id))))

  if (!teamIds.length) {
    return
  }

  const response = await fetch('https://mission.learningrocks.io/missions/add_audience', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      mission_id: missionId,
      user_ids: [],
      team_ids: teamIds,
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao associar time na missao (${response.status})`)
  }

  const mission = getMissionDefinitionWithOverrides(missionId)

  if (!mission) {
    return
  }

  const mergedAudience = [...mission.audience]

  teams.forEach((team) => {
    if (!mergedAudience.some((item) => item.type === 'team' && item.id === String(team.id))) {
      mergedAudience.push({
        id: String(team.id),
        name: team.name,
        type: 'team',
      })
    }
  })

  persistMissionAudienceOverride(missionId, mergedAudience)
  missionOverviewCache = null
}

export async function removeTeamsFromMissionAudience(
  missionId: string,
  teamIds: number[],
) {
  const normalizedIds = Array.from(new Set(teamIds.map((teamId) => String(teamId))))

  if (!normalizedIds.length) {
    return
  }

  const response = await fetch(
    'https://mission.learningrocks.io/missions/remove_audience',
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        mission_id: missionId,
        user_ids: [],
        team_ids: normalizedIds,
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`Falha ao remover time da missao (${response.status})`)
  }

  const mission = getMissionDefinitionWithOverrides(missionId)

  if (!mission) {
    return
  }

  persistMissionAudienceOverride(
    missionId,
    mission.audience.filter(
      (item) => !(item.type === 'team' && normalizedIds.includes(item.id)),
    ),
  )
  missionOverviewCache = null
}

export async function addUsersToMissionAudience(
  missionId: string,
  userIds: number[],
) {
  const normalizedIds = Array.from(new Set(userIds.map((userId) => String(userId))))

  if (!normalizedIds.length) {
    return
  }

  const response = await fetch('https://mission.learningrocks.io/missions/add_audience', {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
    },
    body: JSON.stringify({
      mission_id: missionId,
      user_ids: normalizedIds,
      team_ids: [],
    }),
  })

  if (!response.ok) {
    throw new Error(`Falha ao associar usuarios na missao (${response.status})`)
  }

  missionOverviewCache = null
}

export async function removeUsersFromMissionAudience(
  missionId: string,
  userIds: number[],
) {
  const normalizedIds = Array.from(new Set(userIds.map((userId) => String(userId))))

  if (!normalizedIds.length) {
    return
  }

  const response = await fetch(
    'https://mission.learningrocks.io/missions/remove_audience',
    {
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({
        mission_id: missionId,
        user_ids: normalizedIds,
        team_ids: [],
      }),
    },
  )

  if (!response.ok) {
    throw new Error(`Falha ao remover usuarios da missao (${response.status})`)
  }

  missionOverviewCache = null
  collaboratorMatrixCache = null
}

function persistMissionAudienceOverride(
  missionId: string,
  audience: Array<{ id: string; name: string; type: 'team' | 'user' }>,
) {
  const overrides = readMissionAudienceOverrides()
  overrides[missionId] = { audience }
  writeMissionAudienceOverrides(overrides)
}

export async function fetchCollaboratorMissionMatrix(
  signal?: AbortSignal,
  options?: { refresh?: boolean },
): Promise<CollaboratorMissionMatrix> {
  if (options?.refresh) {
    collaboratorMatrixCache = null
  }

  if (!collaboratorMatrixCache) {
    collaboratorMatrixCache = buildCollaboratorMissionMatrix(signal)
  }
  try {
    return await collaboratorMatrixCache
  } catch (error) {
    collaboratorMatrixCache = null
    throw error
  }
}

export function fetchCollaboratorsDb() {
  return getCollaboratorsDb().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
}

export async function syncCollaboratorsFromServer(signal?: AbortSignal) {
  if (!hasCollaboratorsBackend()) {
    return fetchCollaboratorsDb()
  }

  try {
    const payload = await readJson<CollaboratorsApiResponse>(
      `${collaboratorsApiUrl}/api/collaborators`,
      {
        signal,
        headers: {
          Accept: 'application/json',
        },
      },
    )

    persistCollaboratorsDb(payload.items)
    clearUsersCache()

    return payload.items.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  } catch {
    return fetchCollaboratorsDb()
  }
}

export async function createCollaborator(record: CollaboratorRecord) {
  if (hasCollaboratorsBackend()) {
    const response = await fetch(`${collaboratorsApiUrl}/api/collaborators`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        matricula: record.matricula.trim(),
        nome: record.nome.trim(),
      }),
    })

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? `Falha ao criar colaborador (${response.status})`)
    }

    await syncCollaboratorsFromServer()
    return
  }

  const current = getCollaboratorsDb()

  if (current.some((item) => item.matricula === record.matricula.trim())) {
    throw new Error('Ja existe um colaborador com essa matricula.')
  }

  const next = [
    ...current,
    {
      matricula: record.matricula.trim(),
      nome: record.nome.trim(),
    },
  ]

  persistCollaboratorsDb(next)
  clearUsersCache()
}

export async function updateCollaborator(
  originalMatricula: string,
  record: CollaboratorRecord,
) {
  if (hasCollaboratorsBackend()) {
    const response = await fetch(
      `${collaboratorsApiUrl}/api/collaborators/${encodeURIComponent(originalMatricula)}`,
      {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matricula: record.matricula.trim(),
          nome: record.nome.trim(),
        }),
      },
    )

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? `Falha ao atualizar colaborador (${response.status})`)
    }

    await syncCollaboratorsFromServer()
    return
  }

  const current = getCollaboratorsDb()
  const normalizedMatricula = record.matricula.trim()

  if (
    current.some(
      (item) =>
        item.matricula !== originalMatricula && item.matricula === normalizedMatricula,
    )
  ) {
    throw new Error('Ja existe um colaborador com essa matricula.')
  }

  const next = current.map((item) =>
    item.matricula === originalMatricula
      ? {
          matricula: normalizedMatricula,
          nome: record.nome.trim(),
        }
      : item,
  )

  persistCollaboratorsDb(next)
  clearUsersCache()
}

export async function deleteCollaborator(matricula: string) {
  if (hasCollaboratorsBackend()) {
    const response = await fetch(
      `${collaboratorsApiUrl}/api/collaborators/${encodeURIComponent(matricula)}`,
      {
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
        },
      },
    )

    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      throw new Error(payload?.error ?? `Falha ao excluir colaborador (${response.status})`)
    }

    await syncCollaboratorsFromServer()
    return
  }

  const next = getCollaboratorsDb().filter((item) => item.matricula !== matricula)
  persistCollaboratorsDb(next)
  clearUsersCache()
}

export function subscribeToCollaboratorUpdates(
  onChange: (collaboratorsDb: CollaboratorRecord[]) => void,
) {
  if (typeof window === 'undefined' || !hasCollaboratorsBackend()) {
    return () => undefined
  }

  if (!collaboratorsSocket) {
    collaboratorsSocket = io(collaboratorsApiUrl, {
      transports: ['websocket', 'polling'],
    })
  }

  const handleChange = () => {
    void syncCollaboratorsFromServer()
      .then((items) => onChange(items))
      .catch(() => undefined)
  }

  collaboratorsSocket.on('collaborators:changed', handleChange)

  return () => {
    collaboratorsSocket?.off('collaborators:changed', handleChange)
  }
}

async function fetchRecentMissionUsers(signal?: AbortSignal) {
  const userDetailsCache = new Map<string, Promise<SkoreUserDetailApiItem | null>>()
  const completedEvents = (
    await Promise.all(
      missionAudienceCatalog.map(async (mission) => {
        const items = await fetchMissionEnrollmentsByStatus(mission.id, 'COMPLETED', signal)

        return items.map((item) => ({
          userId: item.user_id,
          completedAt: item.completed_at ?? 0,
        }))
      }),
    )
  )
    .flat()
    .sort((a, b) => b.completedAt - a.completedAt)

  const uniqueUserIds = Array.from(
    new Set(completedEvents.map((item) => item.userId)),
  ).slice(0, 10)

  const users = await Promise.all(
    uniqueUserIds.map((userId) => fetchUserDetailCached(userId, userDetailsCache, signal)),
  )

  return users
    .filter((user): user is SkoreUserDetailApiItem => Boolean(user))
    .map((user) => ({
      id: user.id,
      name:
        getCollaboratorContext().collaboratorNamesByMatricula.get(user.username ?? '') ||
        user.name,
      email: user.email ?? 'Sem email',
      username: user.username,
      role: user.role ?? 'student',
      active: true,
      teamNames: (user.teams ?? []).map((team) => team.name).slice(0, 3),
      createdAtLabel: user.created_at ? formatDateLabel(user.created_at) : 'Missao recente',
    }))
}

async function fetchMissionOverviewMetrics(signal?: AbortSignal) {
  if (!missionOverviewCache) {
    missionOverviewCache = buildMissionOverviewMetrics(signal)
  }
  try {
    return await missionOverviewCache
  } catch (error) {
    missionOverviewCache = null
    throw error
  }
}

async function buildMissionOverviewMetrics(signal?: AbortSignal) {
  const mappedMissions = missionAudienceCatalog.filter((mission) =>
    getMissionDefinitionWithOverrides(mission.id)?.audience.some((item) => item.type === 'team'),
  )

  if (!mappedMissions.length) {
    return {
      missionStatus: mockDashboardData.missionStatus,
      missionRates: mockDashboardData.departments,
      activeMissionCount: missionAudienceCatalog.length,
      notStartedCount: mockDashboardData.overdueTaskCount,
    }
  }

  const snapshots = await Promise.all(
    mappedMissions.map(async (catalogMission) => {
      const mission = getMissionDefinitionWithOverrides(catalogMission.id)

      if (!mission) {
        return null
      }

      const teams = mission.audience.filter(
        (item): item is { id: string; name: string; type: 'team' } => item.type === 'team',
      )
      const members = await resolveMissionAudienceMembers(teams)
      const [completedEnrollments, inProgressEnrollments] = await Promise.all([
        fetchMissionEnrollmentsByStatus(mission.id, 'COMPLETED', signal),
        fetchMissionEnrollmentsByStatus(mission.id, 'IN_PROGRESS', signal),
      ])

      const memberIds = new Set(members.map((member) => String(member.id)))
      const completedIds = new Set(
        completedEnrollments
          .map((item) => item.user_id)
          .filter((userId) => memberIds.has(userId)),
      )
      const inProgressIds = new Set(
        inProgressEnrollments
          .map((item) => item.user_id)
          .filter((userId) => memberIds.has(userId) && !completedIds.has(userId)),
      )

      const audienceCount = members.length
      const completedCount = completedIds.size
      const inProgressCount = inProgressIds.size
      const notStartedCount = Math.max(
        audienceCount - completedCount - inProgressCount,
        0,
      )

      return {
        id: mission.id,
        name: mission.name,
        audienceCount,
        completedCount,
        inProgressCount,
        notStartedCount,
        completionRate:
          audienceCount > 0 ? Math.round((completedCount / audienceCount) * 100) : 0,
      }
    }),
  )

  const validSnapshots = snapshots.filter((item) => item !== null)

  const totalCompleted = validSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.completedCount,
    0,
  )
  const totalInProgress = validSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.inProgressCount,
    0,
  )
  const totalNotStarted = validSnapshots.reduce(
    (sum, snapshot) => sum + snapshot.notStartedCount,
    0,
  )
  const totalTracked = totalCompleted + totalInProgress + totalNotStarted

  const completedPercent =
    totalTracked > 0 ? Math.round((totalCompleted / totalTracked) * 100) : 0
  const inProgressPercent =
    totalTracked > 0 ? Math.round((totalInProgress / totalTracked) * 100) : 0
  const missionStatus =
    totalTracked > 0
      ? [
          {
            label: 'Concluidos',
            value: completedPercent,
            color: '#1ec997',
          },
          {
            label: 'Em andamento',
            value: inProgressPercent,
            color: '#6d6af8',
          },
          {
            label: 'Nao iniciados',
            value: Math.max(0, 100 - completedPercent - inProgressPercent),
            color: '#a5acbb',
          },
        ]
      : mockDashboardData.missionStatus

  const missionRates = validSnapshots
    .sort((a, b) => b.completionRate - a.completionRate)
    .slice(0, 4)
    .map((snapshot) => ({
      label: snapshot.name.split(' - ')[0] ?? snapshot.name,
      value: snapshot.completionRate,
    }))

  return {
    missionStatus,
    missionRates: missionRates.length ? missionRates : mockDashboardData.departments,
    activeMissionCount: missionAudienceCatalog.length,
    notStartedCount: totalNotStarted,
  }
}

async function buildCollaboratorMissionMatrix(
  signal?: AbortSignal,
): Promise<CollaboratorMissionMatrix> {
  const { collaboratorRows } = getCollaboratorContext()
  const collaborators = collaboratorRows
    .map((item) => ({
      matricula: item.matricula,
      name: item.nome,
      missionNames: [] as string[],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  const rowsByMatricula = new Map(collaborators.map((item) => [item.matricula, item]))
  const userDetailsCache = new Map<string, Promise<SkoreUserDetailApiItem | null>>()

  for (const catalogMission of missionAudienceCatalog) {
    const mission = getMissionDefinitionWithOverrides(catalogMission.id)

    if (!mission) {
      continue
    }

    const associatedMatriculas = new Set<string>()
    const teams = mission.audience.filter(
      (item): item is { id: string; name: string; type: 'team' } => item.type === 'team',
    )

    if (teams.length) {
      const members = await resolveMissionAudienceMembers(teams)
      members.forEach((member) => {
        if (member.username) {
          associatedMatriculas.add(member.username)
        }
      })
    }

    const [completedEnrollments, inProgressEnrollments] = await Promise.all([
      fetchMissionEnrollmentsByStatus(mission.id, 'COMPLETED', signal),
      fetchMissionEnrollmentsByStatus(mission.id, 'IN_PROGRESS', signal),
    ])
    const enrollmentUserIds = Array.from(
      new Set(
        [...completedEnrollments, ...inProgressEnrollments].map((item) => item.user_id),
      ),
    )

    const unresolvedUserIds = enrollmentUserIds.filter((userId) => {
      for (const matricula of associatedMatriculas) {
        const row = rowsByMatricula.get(matricula)

        if (row && String(userId) === row.matricula) {
          return false
        }
      }

      return true
    })

    const resolvedUsers = await Promise.all(
      unresolvedUserIds.map((userId) => fetchUserDetailCached(userId, userDetailsCache, signal)),
    )

    resolvedUsers.forEach((user) => {
      if (user?.username) {
        associatedMatriculas.add(user.username)
      }
    })

    associatedMatriculas.forEach((matricula) => {
      const row = rowsByMatricula.get(matricula)

      if (row && !row.missionNames.includes(mission.name)) {
        row.missionNames.push(mission.name)
      }
    })
  }

  collaborators.forEach((item) => {
    item.missionNames.sort((a, b) => a.localeCompare(b, 'pt-BR'))
  })

  return {
    missions: missionAudienceCatalog.map((mission) => ({
      id: mission.id,
      name: mission.name,
    })),
    collaborators,
  }
}

async function resolveMissionAudienceMembers(
  teams: Array<{ id: string; name: string; type: 'team' }>,
) {
  const membersByTeam = await Promise.all(
    teams.map(async (team) => ({
      members: await fetchMembersForTeam(Number(team.id)),
    })),
  )

  const mergedMembers = membersByTeam.flatMap((item) => item.members)

  return mergedMembers
    .filter(
      (member, index, array) =>
        array.findIndex((candidate) => candidate.id === member.id) === index,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

async function fetchMissionEnrollmentsByStatus(
  missionId: string,
  status: 'COMPLETED' | 'IN_PROGRESS',
  signal?: AbortSignal,
) {
  const results: MissionEnrollmentApiItem[] = []
  let offset: string | null = null

  do {
    const url = new URL(
      `https://mission.learningrocks.io/enrollments/by_mission/${missionId}`,
    )
    url.searchParams.set('limit', '100')
    url.searchParams.set('enrollment_status', status)

    if (offset) {
      url.searchParams.set('offset', offset)
    }

    const payload = await readJson<MissionEnrollmentsResponse>(url.toString(), {
      signal,
      headers: {
        Accept: 'application/json',
        ...getAuthHeaders(),
      },
    })

    results.push(...payload.results)
    offset = payload.offset
  } while (offset)

  return results
}

async function fetchUserDetailCached(
  userId: string,
  cache: Map<string, Promise<SkoreUserDetailApiItem | null>>,
  signal?: AbortSignal,
) {
  const cached = cache.get(userId)

  if (cached) {
    return cached
  }

  const request = readJson<SkoreUserDetailApiItem>(
    `https://knowledge.skore.io/workspace/v1/users/${userId}`,
    {
      signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...getAuthHeaders({ rawToken: true }),
      },
    },
  )
    .then((user) => user)
    .catch(() => null)

  cache.set(userId, request)

  return request
}

function includesJslGru(value?: string | null) {
  return value?.toLowerCase().includes(JSL_GRU_FILTER) ?? false
}

function formatTimestampLabel(timestamp: number) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
