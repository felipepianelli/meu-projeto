export type NavItem = {
  label: string
  icon: string
  active?: boolean
}

export type AccessRole = 'admin' | 'admin_plus' | 'viewer'

export type AccessUser = {
  id: string
  name: string
  username: string
  password: string
  role: AccessRole
  description: string
}

export type CollaboratorRecord = {
  matricula: string
  nome: string
}

export type DepartmentMetric = {
  label: string
  value: number
}

export type MissionStatusMetric = {
  label: string
  value: number
  color: string
}

export type SyncEvent = {
  id: string
  title: string
  detail: string
  time: string
  state: 'success' | 'warning' | 'info'
}

export type DashboardData = {
  collaboratorCount: number
  activeMissionCount: number
  overdueTaskCount: number
  departments: DepartmentMetric[]
  missionStatus: MissionStatusMetric[]
  syncEvents: SyncEvent[]
  lastSyncLabel: string
  teams: TeamSummary[]
  users: UserSummary[]
  userEnrollments: UserEnrollmentSummary[]
}

export type ConnectionStatus = {
  connected: boolean
  mode: 'api' | 'mock'
  label: string
}

export type TeamSummary = {
  id: number
  name: string
  usersCount: number
  spacesCount: number
  createdAtLabel: string
  matchedMembersCount: number
  matchedMembers: TeamMember[]
}

export type UserSummary = {
  id: number
  name: string
  email: string
  username: string | null
  role: string
  active: boolean
  teamNames: string[]
  createdAtLabel: string
  recentMissionName?: string
}

export type UserEnrollmentSummary = {
  userId: number
  userName: string
  status: 'loaded' | 'empty' | 'error'
  completedCount: number
  nextOffset: string | null
  detail: string
  missionNames: string[]
  teamNames: string[]
}

export type TeamMember = {
  id: number
  name: string
  username: string | null
  inSpreadsheet: boolean
}

export type MissionAudienceTeam = {
  id: number
  name: string
}

export type MissionAudienceSummary = {
  id: string
  name: string
  active: boolean
  createdAtLabel: string
  audienceTeams: MissionAudienceTeam[]
  memberCount: number
  members: MissionAudienceMember[]
}

export type MissionAudienceMember = TeamMember & {
  missionStatus: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED'
  progressPercentage: number | null
  completedAtLabel: string | null
}

export type CollaboratorMissionRow = {
  matricula: string
  name: string
  missionNames: string[]
  teamNames: string[]
}

export type CollaboratorMissionMatrix = {
  missions: Array<{
    id: string
    name: string
  }>
  collaborators: CollaboratorMissionRow[]
}

export type MissionReportRow = {
  matricula: string
  name: string
  missionName: string
  status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED'
  completedAtLabel: string | null
}

export type MissionCertificateRecord = {
  certificateId: string
  matricula: string
  name: string
  email: string | null
  missionId: string
  missionName: string
  certificateType: string
  certificateTemplateId: string | null
  issuedAtLabel: string | null
}
