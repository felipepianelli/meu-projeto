import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { defaultAccessUsers } from './data/accessUsers'
import { missionAudienceCatalog } from './data/missionAudienceCatalog'
import { useSkoreDashboard } from './hooks/useSkoreDashboard'
import {
  addUsersToTeam,
  addTeamsToMissionAudience,
  addUsersToMissionAudience,
  clearUsersCache,
  createCollaborator,
  deleteCollaborator,
  downloadTeamAuditCsvFromBackend,
  fetchAllMissionReportRows,
  fetchCollaboratorMissionMatrix,
  fetchCollaboratorsDb,
  fetchMissionAudienceMembers,
  findUsersByMatriculas,
  importCollaborators,
  removeTeamsFromMissionAudience,
  removeUsersFromMissionAudience,
  subscribeToCollaboratorUpdates,
  syncCollaboratorsFromServer,
  updateCollaborator,
} from './services/skoreApi'
import type {
  AccessUser,
  CollaboratorRecord,
  CollaboratorMissionMatrix,
  MissionAudienceSummary,
  MissionStatusMetric,
  NavItem,
  SyncEvent,
  TeamSummary,
  UserSummary,
} from './types'

const navItems: NavItem[] = [
  { label: 'Overview', icon: 'grid' },
  { label: 'Missoes', icon: 'book' },
  { label: 'Times', icon: 'users' },
  { label: 'Colaboradores', icon: 'users' },
  { label: 'Matriz', icon: 'table' },
  { label: 'Trilhas', icon: 'flow', active: false },
  { label: 'Usuarios', icon: 'users' },
  { label: 'Relatorios', icon: 'report' },
]

const TEAM_PAGE_SIZE = 10
const COLLABORATOR_PAGE_SIZE = 20
const ACCESS_SESSION_KEY = 'skore_manager_access_user'
const ACCESS_USERS_KEY = 'skore_manager_access_users'
const TIMES_AUTOMATION_ENABLED_KEY = 'skore_manager_times_automation_enabled'
const TIMES_AUTOMATION_TIME_KEY = 'skore_manager_times_automation_time'
const TIMES_AUTOMATION_LAST_RUN_KEY = 'skore_manager_times_automation_last_run'
const REPORTS_AUTOMATION_ENABLED_KEY = 'skore_manager_reports_automation_enabled'
const REPORTS_AUTOMATION_TIMES_KEY = 'skore_manager_reports_automation_times'
const REPORTS_AUTOMATION_LAST_RUN_KEY = 'skore_manager_reports_automation_last_run'

function App() {
  const [activeTab, setActiveTab] = useState('Overview')
  const [timesSubTab, setTimesSubTab] = useState<'assign' | 'audit'>('assign')
  const [showLoginPanel, setShowLoginPanel] = useState(false)
  const [accessUsersState, setAccessUsersState] = useState<AccessUser[]>(() =>
    getStoredAccessUsers(),
  )
  const [currentAccessUser, setCurrentAccessUser] = useState<AccessUser | null>(() =>
    getInitialAccessUser(),
  )
  const [accessError, setAccessError] = useState<string | null>(null)
  const [editingAccessUserId, setEditingAccessUserId] = useState<string | null>(null)
  const [collaboratorMatrix, setCollaboratorMatrix] = useState<CollaboratorMissionMatrix | null>(
    null,
  )
  const [collaboratorsDb, setCollaboratorsDb] = useState<CollaboratorRecord[]>(() =>
    fetchCollaboratorsDb(),
  )
  const [isLoadingCollaboratorMatrix, setIsLoadingCollaboratorMatrix] = useState(false)
  const [collaboratorMatrixError, setCollaboratorMatrixError] = useState<string | null>(null)
  const [isSyncingTimes, setIsSyncingTimes] = useState(false)
  const [timesAutomationEnabled, setTimesAutomationEnabled] = useState(() =>
    getStoredBoolean(TIMES_AUTOMATION_ENABLED_KEY, false),
  )
  const [timesAutomationTime, setTimesAutomationTime] = useState(() =>
    getStoredTime(TIMES_AUTOMATION_TIME_KEY, '07:00'),
  )
  const [timesAutomationFeedback, setTimesAutomationFeedback] = useState<string | null>(null)
  const [isExportingReports, setIsExportingReports] = useState(false)
  const [reportsAutomationEnabled, setReportsAutomationEnabled] = useState(() =>
    getStoredBoolean(REPORTS_AUTOMATION_ENABLED_KEY, false),
  )
  const [reportsAutomationTimes, setReportsAutomationTimes] = useState(() =>
    getStoredTimes(REPORTS_AUTOMATION_TIMES_KEY, ['08:00', '12:00', '17:00']),
  )
  const [reportsAutomationFeedback, setReportsAutomationFeedback] = useState<string | null>(null)
  const [editingCollaboratorMatricula, setEditingCollaboratorMatricula] = useState<string | null>(
    null,
  )
  const [collaboratorFeedback, setCollaboratorFeedback] = useState<string | null>(null)
  const {
    connection,
    data,
    error,
    isLoading,
    isRefreshing,
    refresh,
  } = useSkoreDashboard()

  const missionStatus = data?.missionStatus ?? []
  const departments = data?.departments ?? []
  const syncEvents = data?.syncEvents ?? []
  const teams = data?.teams ?? []
  const users = data?.users ?? []
  const canManage =
    currentAccessUser?.role === 'admin' || currentAccessUser?.role === 'admin_plus'
  const canManageUsers = currentAccessUser?.role === 'admin_plus'

  function handleSignIn(username: string, password: string) {
    const matchedUser = accessUsersState.find(
      (user) => user.username === username && user.password === password,
    )

    if (!matchedUser) {
      setAccessError('Usuario ou senha invalidos.')
      return
    }

    setCurrentAccessUser(matchedUser)
    setAccessError(null)
    persistAccessUser(matchedUser)
    setShowLoginPanel(false)
  }

  function handleSignOut() {
    setCurrentAccessUser(null)
    setAccessError(null)
    clearPersistedAccessUser()
    setShowLoginPanel(true)
  }

  useEffect(() => {
    if (!currentAccessUser) {
      setShowLoginPanel(true)
    }
  }, [currentAccessUser])

  async function refreshCollaboratorSources(options?: { refreshDashboard?: boolean }) {
    const nextCollaborators = await syncCollaboratorsFromServer()
    setCollaboratorsDb(nextCollaborators)
    setCollaboratorMatrix(null)

    if (options?.refreshDashboard) {
      await refresh()
    }
  }

  async function handleCreateCollaborator(record: CollaboratorRecord) {
    try {
      await createCollaborator(record)
      await refreshCollaboratorSources({ refreshDashboard: true })
      setCollaboratorFeedback('Colaborador adicionado.')
      window.setTimeout(() => setCollaboratorFeedback(null), 2200)
    } catch (error) {
      setCollaboratorFeedback(
        error instanceof Error ? error.message : 'Falha ao adicionar colaborador.',
      )
      window.setTimeout(() => setCollaboratorFeedback(null), 2600)
    }
  }

  async function handleUpdateCollaborator(
    originalMatricula: string,
    record: CollaboratorRecord,
  ) {
    try {
      await updateCollaborator(originalMatricula, record)
      setEditingCollaboratorMatricula(null)
      await refreshCollaboratorSources({ refreshDashboard: true })
      setCollaboratorFeedback('Colaborador atualizado.')
      window.setTimeout(() => setCollaboratorFeedback(null), 2200)
    } catch (error) {
      setCollaboratorFeedback(
        error instanceof Error ? error.message : 'Falha ao atualizar colaborador.',
      )
      window.setTimeout(() => setCollaboratorFeedback(null), 2600)
    }
  }

  async function handleDeleteCollaborator(matricula: string) {
    try {
      await deleteCollaborator(matricula)
      if (editingCollaboratorMatricula === matricula) {
        setEditingCollaboratorMatricula(null)
      }
      await refreshCollaboratorSources({ refreshDashboard: true })
      setCollaboratorFeedback('Colaborador excluido.')
      window.setTimeout(() => setCollaboratorFeedback(null), 2200)
    } catch (error) {
      setCollaboratorFeedback(
        error instanceof Error ? error.message : 'Falha ao excluir colaborador.',
      )
      window.setTimeout(() => setCollaboratorFeedback(null), 2600)
    }
  }

  async function handleImportCollaborators(records: CollaboratorRecord[]) {
    try {
      const total = await importCollaborators(records)
      setEditingCollaboratorMatricula(null)
      await refreshCollaboratorSources({ refreshDashboard: true })
      setCollaboratorFeedback(
        `Lista semanal importada com sucesso. ${total} colaboradores ativos carregados.`,
      )
      window.setTimeout(() => setCollaboratorFeedback(null), 3200)
    } catch (error) {
      setCollaboratorFeedback(
        error instanceof Error ? error.message : 'Falha ao importar a lista semanal de ativos.',
      )
      window.setTimeout(() => setCollaboratorFeedback(null), 3200)
    }
  }

  async function runReportsExport(mode: 'manual' | 'automatic', slotKey?: string) {
    try {
      await handleDownloadAllReports(setIsExportingReports)

      if (mode === 'automatic' && slotKey) {
        const todayStamp = getTodayStamp()
        const nextRunMap = readStoredRunMap(REPORTS_AUTOMATION_LAST_RUN_KEY)
        nextRunMap[slotKey] = todayStamp
        window.localStorage.setItem(
          REPORTS_AUTOMATION_LAST_RUN_KEY,
          JSON.stringify(nextRunMap),
        )
        setReportsAutomationFeedback(
          `Relatorio automatico gerado em ${formatDateTimeNow()}.`,
        )
      } else {
        setReportsAutomationFeedback(`Relatorio gerado em ${formatDateTimeNow()}.`)
      }
    } catch (error) {
      setReportsAutomationFeedback(
        error instanceof Error ? error.message : 'Falha ao gerar o relatorio.',
      )
    }

    window.setTimeout(() => setReportsAutomationFeedback(null), 3200)
  }

  async function runTimesSync(mode: 'manual' | 'automatic') {
    setIsSyncingTimes(true)

    try {
      clearUsersCache()
      setCollaboratorMatrix(null)
      await refresh()

      if (mode === 'automatic') {
        const todayStamp = getTodayStamp()
        window.localStorage.setItem(TIMES_AUTOMATION_LAST_RUN_KEY, todayStamp)
        setTimesAutomationFeedback(
          `Cargas de times atualizadas automaticamente em ${formatDateTimeNow()}.`,
        )
      } else {
        setTimesAutomationFeedback(
          `Cargas de times atualizadas em ${formatDateTimeNow()}.`,
        )
      }
    } catch (error) {
      setTimesAutomationFeedback(
        error instanceof Error ? error.message : 'Falha ao atualizar as cargas de times.',
      )
    } finally {
      setIsSyncingTimes(false)
    }

    window.setTimeout(() => setTimesAutomationFeedback(null), 3200)
  }

  function handleCreateAccessUser(input: {
    name: string
    username: string
    password: string
    role: AccessUser['role']
  }) {
    const normalizedUsername = input.username.trim()

    if (
      accessUsersState.some(
        (user) => user.username.toLowerCase() === normalizedUsername.toLowerCase(),
      )
    ) {
      setAccessError('Ja existe um usuario com esse login.')
      return
    }

    const createdUser: AccessUser = {
      id: `custom-${Date.now()}`,
      name: input.name.trim(),
      username: normalizedUsername,
      password: input.password,
      role: input.role,
      description:
        input.role === 'admin_plus'
          ? 'Pode visualizar, editar e administrar usuarios.'
          : input.role === 'admin'
            ? 'Pode editar tudo, menos a aba de usuarios.'
            : 'Pode visualizar e baixar arquivos XLS.',
    }

    const nextUsers = [...accessUsersState, createdUser]
    setAccessUsersState(nextUsers)
    persistAccessUsers(nextUsers)
    setAccessError(null)
  }

  function handleUpdateAccessUser(
    userId: string,
    input: {
      name: string
      username: string
      password: string
      role: AccessUser['role']
    },
  ) {
    const normalizedUsername = input.username.trim()
    const duplicate = accessUsersState.some(
      (user) =>
        user.id !== userId &&
        user.username.toLowerCase() === normalizedUsername.toLowerCase(),
    )

    if (duplicate) {
      setAccessError('Ja existe um usuario com esse login.')
      return
    }

    const nextUsers = accessUsersState.map((user) =>
      user.id === userId
        ? {
            ...user,
            name: input.name.trim(),
            username: normalizedUsername,
            password: input.password,
            role: input.role,
            description:
              input.role === 'admin_plus'
                ? 'Pode visualizar, editar e administrar usuarios.'
                : input.role === 'admin'
                  ? 'Pode editar tudo, menos a aba de usuarios.'
                  : 'Pode visualizar e baixar arquivos XLS.',
          }
        : user,
    )

    setAccessUsersState(nextUsers)
    persistAccessUsers(nextUsers)
    setEditingAccessUserId(null)
    setAccessError(null)

    if (currentAccessUser?.id === userId) {
      const updatedCurrent = nextUsers.find((user) => user.id === userId) ?? null
      setCurrentAccessUser(updatedCurrent)

      if (updatedCurrent) {
        persistAccessUser(updatedCurrent)
      }
    }
  }

  function handleDeleteAccessUser(userId: string) {
    if (currentAccessUser?.id === userId) {
      setAccessError('Nao e possivel excluir o usuario atualmente logado.')
      return
    }

    const nextUsers = accessUsersState.filter((user) => user.id !== userId)
    setAccessUsersState(nextUsers)
    persistAccessUsers(nextUsers)
    setAccessError(null)

    if (editingAccessUserId === userId) {
      setEditingAccessUserId(null)
    }
  }

  useEffect(() => {
    if (!canManageUsers && activeTab === 'Usuarios') {
      setActiveTab('Overview')
    }
  }, [activeTab, canManageUsers])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      TIMES_AUTOMATION_ENABLED_KEY,
      timesAutomationEnabled ? 'true' : 'false',
    )
  }, [timesAutomationEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(TIMES_AUTOMATION_TIME_KEY, timesAutomationTime)
  }, [timesAutomationTime])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      REPORTS_AUTOMATION_ENABLED_KEY,
      reportsAutomationEnabled ? 'true' : 'false',
    )
  }, [reportsAutomationEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      REPORTS_AUTOMATION_TIMES_KEY,
      JSON.stringify(reportsAutomationTimes),
    )
  }, [reportsAutomationTimes])

  useEffect(() => {
    void refreshCollaboratorSources({ refreshDashboard: true })

    const unsubscribe = subscribeToCollaboratorUpdates((items) => {
      setCollaboratorsDb(items)
      setCollaboratorMatrix(null)
      void refresh()
      setCollaboratorFeedback('Banco de colaboradores sincronizado em tempo real.')
      window.setTimeout(() => setCollaboratorFeedback(null), 2200)
    })

    return unsubscribe
  }, [])

  useEffect(() => {
    if (!timesAutomationEnabled || isSyncingTimes) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      const scheduledTime = parseTimeValue(timesAutomationTime)

      if (!scheduledTime) {
        return
      }

      const now = new Date()
      const todayStamp = getTodayStamp(now)
      const lastRunStamp =
        typeof window !== 'undefined'
          ? window.localStorage.getItem(TIMES_AUTOMATION_LAST_RUN_KEY)
          : null

      if (lastRunStamp === todayStamp) {
        return
      }

      const scheduledAt = new Date(now)
      scheduledAt.setHours(scheduledTime.hours, scheduledTime.minutes, 0, 0)

      if (now >= scheduledAt) {
        void runTimesSync('automatic')
      }
    }, 30000)

    return () => window.clearInterval(intervalId)
  }, [timesAutomationEnabled, timesAutomationTime, isSyncingTimes])

  useEffect(() => {
    if (!reportsAutomationEnabled || isExportingReports) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return
      }

      const now = new Date()
      const todayStamp = getTodayStamp(now)
      const lastRunMap =
        typeof window !== 'undefined'
          ? readStoredRunMap(REPORTS_AUTOMATION_LAST_RUN_KEY)
          : {}

      reportsAutomationTimes.forEach((timeValue, index) => {
        const scheduledTime = parseTimeValue(timeValue)

        if (!scheduledTime) {
          return
        }

        const slotKey = `slot_${index}`

        if (lastRunMap[slotKey] === todayStamp) {
          return
        }

        const scheduledAt = new Date(now)
        scheduledAt.setHours(scheduledTime.hours, scheduledTime.minutes, 0, 0)

        if (now >= scheduledAt) {
          void runReportsExport('automatic', slotKey)
        }
      })
    }, 30000)

    return () => window.clearInterval(intervalId)
  }, [reportsAutomationEnabled, reportsAutomationTimes, isExportingReports])

  useEffect(() => {
    if (activeTab !== 'Colaboradores' && activeTab !== 'Matriz') {
      return
    }

    if (collaboratorMatrix || isLoadingCollaboratorMatrix) {
      return
    }

    setIsLoadingCollaboratorMatrix(true)
    setCollaboratorMatrixError(null)

    void fetchCollaboratorMissionMatrix()
      .then((result) => {
        setCollaboratorMatrix(result)
      })
      .catch((error) => {
        setCollaboratorMatrixError(
          error instanceof Error
            ? error.message
            : 'Falha ao carregar a matriz de colaboradores.',
        )
      })
      .finally(() => {
        setIsLoadingCollaboratorMatrix(false)
      })
  }, [activeTab, collaboratorMatrix, isLoadingCollaboratorMatrix])

  const visibleNavItems = navItems.map((item) =>
    item.label === 'Usuarios' && !canManageUsers ? { ...item, active: false } : item,
  )

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">S</div>
          <div className="brand-copy">
            <strong>Skore</strong>
            <span>Mgr</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Principal">
          {visibleNavItems.map((item) => (
            <button
              key={item.label}
              className={`nav-item${activeTab === item.label ? ' is-active' : ''}${item.active === false ? ' is-disabled' : ''}`}
              type="button"
              onClick={() => {
                if (item.active === false) {
                  return
                }

                setActiveTab(item.label)
              }}
              disabled={item.active === false}
            >
              <NavIcon icon={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">v1.0.0 Alpha</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <h1>{activeTab}</h1>

          <div className="topbar-actions">
            <div className="access-pill">
              <strong>{currentAccessUser?.name ?? 'Sem sessao'}</strong>
              <span>{formatAccessRoleLabel(currentAccessUser?.role)}</span>
            </div>
            <div
              className={`status-pill${connection?.connected ? '' : ' is-offline'}`}
            >
              <span className="status-dot" />
              {connection?.connected
                ? connection.label
                : connection?.label ?? 'Verificando conexao'}
            </div>
            <button
              className="secondary-button"
              onClick={() => setShowLoginPanel((current) => !current)}
            >
              {currentAccessUser ? 'Trocar login' : 'Login'}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                void Promise.all([
                  refresh(),
                  refreshCollaboratorSources(),
                ])
              }
              disabled={isLoading || isRefreshing}
            >
              {isRefreshing ? 'Atualizando...' : 'Atualizar dados'}
            </button>
            <button
              className="icon-button"
              aria-label="Sair"
              onClick={handleSignOut}
            >
              <ExitIcon />
            </button>
            <button className="icon-button" aria-label="Configuracoes">
              <SettingsIcon />
            </button>
          </div>
        </header>

        {error ? <p className="feedback-banner">{error}</p> : null}

        {showLoginPanel ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Login do Prototipo</h3>
              </div>
              <AccessLoginPanel error={accessError} onSignIn={handleSignIn} />
            </article>
          </section>
        ) : null}

        {activeTab === 'Overview' ? (
          <>
            <section className="stats-grid">
              <article className="stat-card card">
                <span>Total Colaboradores</span>
                <strong>{isLoading ? '--' : data?.collaboratorCount ?? '--'}</strong>
              </article>

              <article className="stat-card card">
                <span>Missoes Ativas</span>
                <strong>{isLoading ? '--' : data?.activeMissionCount ?? '--'}</strong>
              </article>

              <article className="stat-card card is-danger">
                <span>Tarefas em Atraso</span>
                <strong>{isLoading ? '--' : data?.overdueTaskCount ?? '--'}</strong>
              </article>
            </section>

            <section className="charts-grid">
              <article className="card chart-card">
                <div className="card-header">
                  <h3>Status Geral das Missoes Mapeadas</h3>
                </div>

                <div className="donut-wrap">
                  <div
                    className="donut-chart"
                    style={{
                      background: `conic-gradient(${buildDonutGradient(missionStatus)})`,
                    }}
                    aria-label="Grafico de status das missoes"
                  >
                    <div className="donut-hole" />
                  </div>

                  <div className="legend">
                    {missionStatus.map((segment) => (
                      <div key={segment.label} className="legend-item">
                        <span
                          className="legend-swatch"
                          style={{ backgroundColor: segment.color }}
                        />
                        <div>
                          <strong>{segment.label}</strong>
                          <span>{segment.value}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </article>

              <article className="card chart-card">
                <div className="card-header">
                  <h3>Conclusao por Missao</h3>
                </div>

                <div className="bars-panel">
                  <div className="bars-axis">
                    <span>100</span>
                    <span>75</span>
                    <span>50</span>
                    <span>25</span>
                    <span>0</span>
                  </div>

                  <div className="bars-chart">
                    {departments.map((department) => (
                      <div key={department.label} className="bar-group">
                        <div className="bar-track">
                          <div
                            className="bar-fill"
                            style={{ height: `${department.value}%` }}
                          />
                        </div>
                        <span>{department.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            </section>

            <section className="sync-grid">
              <article className="card sync-card">
                <div className="card-header">
                  <h3>Fila de sincronizacao</h3>
                </div>

                <div className="sync-list">
                  {syncEvents.map((event) => (
                    <SyncItem key={event.id} event={event} />
                  ))}
                </div>
              </article>

              <article className="card sync-card">
                <div className="card-header">
                  <h3>Ultimas 10 pessoas com missao</h3>
                </div>

                <div className="entity-list">
                  {users.map((user) => (
                    <UserItem key={user.id} user={user} compactRecent />
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {activeTab === 'Missoes' ? (
          <>
            <section className="mission-users-grid">
              <article className="card sync-card">
                <div className="card-header">
                  <h3>Usuarios por Missao</h3>
                </div>

                <div className="mission-team-list">
                  {missionAudienceCatalog.map((mission) => (
                    <MissionAudienceItem
                      key={mission.id}
                      missionId={mission.id}
                      teams={teams}
                      canManage={canManage}
                    />
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {activeTab === 'Times' ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Times</h3>
              </div>

              <div className="times-subtabs">
                <button
                  className={`secondary-button${timesSubTab === 'assign' ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setTimesSubTab('assign')}
                >
                  Atribuicao de Times
                </button>
                <button
                  className={`secondary-button${timesSubTab === 'audit' ? ' is-active' : ''}`}
                  type="button"
                  onClick={() => setTimesSubTab('audit')}
                >
                  Auditoria de Times
                </button>
              </div>

              {timesSubTab === 'audit' ? (
                <p className="mission-empty">
                  A auditoria dos times e preparada em segundo plano durante esta sessao para acelerar os downloads.
                </p>
              ) : null}

              <div className="reports-automation-card">
                <label className="reports-automation-toggle">
                  <input
                    type="checkbox"
                    checked={timesAutomationEnabled}
                    onChange={(event) => setTimesAutomationEnabled(event.target.checked)}
                  />
                  <span>Atualizar cargas de times automaticamente com o site aberto</span>
                </label>

                <div className="reports-automation-times">
                  <div className="reports-automation-controls">
                    <span className="reports-automation-label">Horario diario</span>
                    <input
                      className="audience-select"
                      type="time"
                      value={timesAutomationTime}
                      onChange={(event) => setTimesAutomationTime(event.target.value)}
                    />
                  </div>
                </div>

                <span className="reports-automation-hint">
                  O site limpa os caches locais da sessao e recarrega os times no horario configurado.
                </span>

                {timesAutomationFeedback ? (
                  <p className="upload-feedback">{timesAutomationFeedback}</p>
                ) : null}

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void runTimesSync('manual')}
                  disabled={isSyncingTimes || isRefreshing}
                >
                  {isSyncingTimes ? 'Atualizando times...' : 'Atualizar cargas de times agora'}
                </button>
              </div>

              <div className="mission-team-list">
                {teams.map((team) =>
                  timesSubTab === 'assign' ? (
                    <MissionTeamItem key={team.id} team={team} canManage={canManage} />
                  ) : (
                    <TeamAuditItem key={team.id} team={team} />
                  ),
                )}
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === 'Colaboradores' ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Colaboradores</h3>
              </div>

              <CollaboratorMissionTable
                data={collaboratorMatrix}
                isLoading={isLoadingCollaboratorMatrix}
                error={collaboratorMatrixError}
                collaborators={collaboratorsDb}
                canManage={canManage}
                feedback={collaboratorFeedback}
                editingMatricula={editingCollaboratorMatricula}
                onStartEdit={setEditingCollaboratorMatricula}
                onCancelEdit={() => setEditingCollaboratorMatricula(null)}
                onCreateCollaborator={handleCreateCollaborator}
                onUpdateCollaborator={handleUpdateCollaborator}
                onDeleteCollaborator={handleDeleteCollaborator}
                onImportCollaborators={handleImportCollaborators}
              />
            </article>
          </section>
        ) : null}

        {activeTab === 'Matriz' ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Matriz de Missoes</h3>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() =>
                    collaboratorMatrix
                      ? downloadCollaboratorMissionMatrix(collaboratorMatrix)
                      : undefined
                  }
                  disabled={!collaboratorMatrix}
                >
                  Baixar XLS
                </button>
              </div>

              <CollaboratorMissionMatrixTable
                data={collaboratorMatrix}
                isLoading={isLoadingCollaboratorMatrix}
                error={collaboratorMatrixError}
              />
            </article>
          </section>
        ) : null}

        {activeTab === 'Relatorios' ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Relatorios</h3>
              </div>
              <div className="reports-actions">
                <p className="mission-empty">
                  Baixe um unico XLS com matricula, nome, status da missao e nome da missao.
                </p>
                <div className="reports-automation-card">
                  <label className="reports-automation-toggle">
                    <input
                      type="checkbox"
                      checked={reportsAutomationEnabled}
                      onChange={(event) => setReportsAutomationEnabled(event.target.checked)}
                    />
                    <span>Gerar automaticamente com o site aberto</span>
                  </label>
                  <div className="reports-automation-times">
                    {reportsAutomationTimes.map((timeValue, index) => (
                      <div key={`report-time-${index}`} className="reports-automation-controls">
                        <span className="reports-automation-label">Horario {index + 1}</span>
                        <input
                          className="audience-select"
                          type="time"
                          value={timeValue}
                          onChange={(event) =>
                            setReportsAutomationTimes((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? event.target.value : item,
                              ),
                            )
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <span className="reports-automation-hint">
                    O site precisa permanecer aberto nesses horarios.
                  </span>
                  {reportsAutomationFeedback ? (
                    <p className="upload-feedback">{reportsAutomationFeedback}</p>
                  ) : null}
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => void runReportsExport('manual')}
                  disabled={isExportingReports}
                >
                  {isExportingReports ? 'Gerando relatorio...' : 'Baixar todos os relatorios'}
                </button>
              </div>
            </article>
          </section>
        ) : null}

        {activeTab === 'Usuarios' ? (
          <section className="mission-users-grid">
            <article className="card sync-card">
              <div className="card-header">
                <h3>Acessos</h3>
              </div>
              <AccessUsersPanel
                currentUser={currentAccessUser}
                users={accessUsersState}
                canManageUsers={canManageUsers}
                editingUserId={editingAccessUserId}
                onCreateUser={handleCreateAccessUser}
                onStartEditUser={setEditingAccessUserId}
                onCancelEditUser={() => setEditingAccessUserId(null)}
                onUpdateUser={handleUpdateAccessUser}
                onDeleteUser={handleDeleteAccessUser}
              />
            </article>
          </section>
        ) : null}
      </main>
    </div>
  )
}

function buildDonutGradient(segments: MissionStatusMetric[]) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0)

  if (!segments.length || total === 0) {
    return '#232736 0% 100%'
  }

  let accumulated = 0

  return segments
    .map((segment) => {
      const start = accumulated
      accumulated += (segment.value / total) * 100
      return `${segment.color} ${start}% ${accumulated}%`
    })
    .join(', ')
}

function SyncItem({ event }: { event: SyncEvent }) {
  return (
    <div className="sync-item">
      <span className={`sync-badge is-${event.state}`} />
      <div className="sync-copy">
        <strong>{event.title}</strong>
        <p>{event.detail}</p>
      </div>
      <time>{event.time}</time>
    </div>
  )
}

function UserItem({ user, compactRecent = false }: { user: UserSummary; compactRecent?: boolean }) {
  return (
    <div className="entity-item">
      <div className="entity-main">
        <strong>{user.name}</strong>
        <p>{user.username ? `Matricula ${user.username}` : user.email}</p>
      </div>
      <div className="entity-meta">
        <span>{user.createdAtLabel}</span>
        {!compactRecent ? (
          <>
            <span>{user.role}</span>
            <span>{user.teamNames.length ? user.teamNames.join(', ') : 'Sem time'}</span>
          </>
        ) : null}
      </div>
    </div>
  )
}

function MissionTeamItem({
  team,
  canManage,
}: {
  team: TeamSummary
  canManage: boolean
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setIsUploading(true)
    setUploadMessage(null)

    try {
      const matriculas = await readMatriculasFromWorkbook(file)

      if (!matriculas.length) {
        throw new Error('Nenhuma matricula encontrada no arquivo.')
      }

      const users = await findUsersByMatriculas(matriculas)

      if (!users.length) {
        throw new Error('Nenhum colaborador da planilha foi encontrado na API.')
      }

      await addUsersToTeam(
        team.id,
        users.map((user) => user.id),
      )
      clearUsersCache()
      setUploadMessage(
        `${users.length} colaborador(es) enviados para participacao no time ${team.name}.`,
      )
    } catch (error) {
      setUploadMessage(
        error instanceof Error ? error.message : 'Falha ao processar o arquivo.',
      )
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  return (
    <div className="mission-team-card">
      <div className="mission-team-head">
        <strong>{team.name}</strong>
        <div className="mission-team-actions">
          <div className="entity-meta">
            <span>{team.usersCount} participantes</span>
          </div>
          <div className="team-action-group">
            <button
              className="secondary-button"
              type="button"
              onClick={openFilePicker}
              disabled={isUploading || !canManage}
            >
              {isUploading ? 'Enviando...' : 'Atribuir Colaborador'}
            </button>
          </div>
          <input
            ref={fileInputRef}
            className="hidden-file-input"
            type="file"
            accept=".xls,.xlsx"
            onChange={(event) => void handleFileChange(event)}
          />
        </div>
      </div>

      {!canManage ? (
        <p className="upload-feedback">Perfil de visualizacao: acoes de edicao estao bloqueadas.</p>
      ) : null}
      {uploadMessage ? <p className="upload-feedback">{uploadMessage}</p> : null}
    </div>
  )
}

function TeamAuditItem({
  team,
}: {
  team: TeamSummary
}) {
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  return (
    <div className="mission-team-card">
      <div className="mission-team-head">
        <strong>{team.name}</strong>
        <div className="mission-team-actions">
          <div className="entity-meta">
            <span>{team.usersCount} participantes no site</span>
          </div>
          <div className="team-action-group">
            <button
              className="secondary-button"
              type="button"
              onClick={async () => {
                setIsLoadingMembers(true)
                setFeedback(null)

                try {
                  const total = await downloadTeamAuditCsvFromBackend(team.id, team.name)
                  setFeedback(
                    `${total} participante(s) auditados e baixados em CSV para o time ${team.name}.`,
                  )
                } catch (error) {
                  setFeedback(
                    error instanceof Error
                      ? error.message
                      : 'Falha ao auditar os usuarios deste time.',
                  )
                } finally {
                  setIsLoadingMembers(false)
                }
              }}
              disabled={isLoadingMembers}
            >
              {isLoadingMembers ? 'Gerando CSV...' : 'Baixar CSV'}
            </button>
          </div>
        </div>
      </div>

      <p className="mission-empty">
        Clique em `Baixar CSV` para gerar a auditoria completa dos participantes deste time.
      </p>

      {feedback ? <p className="upload-feedback">{feedback}</p> : null}
    </div>
  )
}

function MissionAudienceItem({
  missionId,
  teams,
  canManage,
}: {
  missionId: string
  teams: TeamSummary[]
  canManage: boolean
}) {
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(false)
  const [isUpdatingAudience, setIsUpdatingAudience] = useState(false)
  const [summary, setSummary] = useState<MissionAudienceSummary | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string>('')
  const addUsersInputRef = useRef<HTMLInputElement | null>(null)
  const removeUsersInputRef = useRef<HTMLInputElement | null>(null)

  const members = summary?.members ?? []
  const totalPages = Math.max(1, Math.ceil(members.length / TEAM_PAGE_SIZE))
  const startIndex = (page - 1) * TEAM_PAGE_SIZE
  const visibleMembers = members.slice(startIndex, startIndex + TEAM_PAGE_SIZE)

  async function loadMissionAudience() {
    setIsLoading(true)
    setFeedback(null)

    try {
      const loadedSummary = await fetchMissionAudienceMembers(missionId)

      if (!loadedSummary) {
        throw new Error('Missao nao encontrada no catalogo local.')
      }

      setSummary(loadedSummary)
      setPage(1)
      setFeedback(
        `${loadedSummary.memberCount} pessoa(s) associada(s) a esta missao.`,
      )
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Falha ao carregar os associados desta missao.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function runAudienceRefresh(successMessage: string) {
    const loadedSummary = await fetchMissionAudienceMembers(missionId)

    if (!loadedSummary) {
      throw new Error('Missao nao encontrada no catalogo local.')
    }

    setSummary(loadedSummary)
    setPage(1)
    setFeedback(successMessage)
  }

  async function handleAddTeam() {
    if (!selectedTeamId) {
      setFeedback('Escolha um time antes de associar.')
      return
    }

    const selectedTeam = teams.find((team) => String(team.id) === selectedTeamId)

    if (!selectedTeam) {
      setFeedback('Time selecionado nao encontrado.')
      return
    }

    setIsUpdatingAudience(true)
    setFeedback(null)

    try {
      await addTeamsToMissionAudience(missionId, [
        { id: selectedTeam.id, name: selectedTeam.name },
      ])
      await runAudienceRefresh(`Time ${selectedTeam.name} associado com sucesso.`)
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Falha ao associar time na missao.',
      )
    } finally {
      setIsUpdatingAudience(false)
    }
  }

  async function handleRemoveTeam() {
    if (!selectedTeamId) {
      setFeedback('Escolha um time antes de remover.')
      return
    }

    const selectedTeam = teams.find((team) => String(team.id) === selectedTeamId)

    if (!selectedTeam) {
      setFeedback('Time selecionado nao encontrado.')
      return
    }

    setIsUpdatingAudience(true)
    setFeedback(null)

    try {
      await removeTeamsFromMissionAudience(missionId, [selectedTeam.id])
      await runAudienceRefresh(`Time ${selectedTeam.name} removido com sucesso.`)
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : 'Falha ao remover time da missao.',
      )
    } finally {
      setIsUpdatingAudience(false)
    }
  }

  async function handleUsersFileAction(
    event: React.ChangeEvent<HTMLInputElement>,
    action: 'add' | 'remove',
  ) {
    const file = event.target.files?.[0]

    if (!file) {
      return
    }

    setIsUpdatingAudience(true)
    setFeedback(null)

    try {
      const matriculas = await readMatriculasFromWorkbook(file)

      if (!matriculas.length) {
        throw new Error('Nenhuma matricula encontrada no arquivo.')
      }

      const users = await findUsersByMatriculas(matriculas)

      if (!users.length) {
        throw new Error('Nenhum colaborador da planilha foi encontrado na API.')
      }

      if (action === 'add') {
        await addUsersToMissionAudience(
          missionId,
          users.map((user) => user.id),
        )
        await runAudienceRefresh(`${users.length} usuario(s) associado(s) a missao.`)
      } else {
        await removeUsersFromMissionAudience(
          missionId,
          users.map((user) => user.id),
        )
        await runAudienceRefresh(`${users.length} usuario(s) removido(s) da missao.`)
      }
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar usuarios da missao.',
      )
    } finally {
      setIsUpdatingAudience(false)
      event.target.value = ''
    }
  }

  return (
    <div className="mission-team-card">
      <div className="mission-team-head">
        <div className="mission-audience-copy">
          <strong>{summary?.name ?? missionAudienceCatalog.find((mission) => mission.id === missionId)?.name ?? missionId}</strong>
          <p>
            {summary?.createdAtLabel ?? 'Missao real da plataforma'} ·{' '}
            {summary?.audienceTeams.length ?? 1} time(s) de audiencia
          </p>
        </div>

        <div className="mission-team-actions">
          <div className="entity-meta">
            <span>{summary?.memberCount ?? '--'} associados</span>
          </div>
          <div className="team-action-group">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadMissionAudience()}
              disabled={isLoading}
            >
              {isLoading ? 'Carregando...' : 'Carregar associados'}
            </button>
            <select
              className="audience-select"
              value={selectedTeamId}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              disabled={isUpdatingAudience || !canManage}
            >
              <option value="">Selecionar time</option>
              {teams.map((team) => (
                <option key={`${missionId}-${team.id}`} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleAddTeam()}
              disabled={isUpdatingAudience || !canManage}
            >
              Associar Time
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleRemoveTeam()}
              disabled={isUpdatingAudience || !canManage}
            >
              Remover Time
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => addUsersInputRef.current?.click()}
              disabled={isUpdatingAudience || !canManage}
            >
              Associar Usuario
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => removeUsersInputRef.current?.click()}
              disabled={isUpdatingAudience || !canManage}
            >
              Remover Usuario
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                downloadMissionAudienceMembers(summary?.name ?? missionId, members)
              }
              disabled={!members.length}
            >
              Baixar XLS
            </button>
            <input
              ref={addUsersInputRef}
              className="hidden-file-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={(event) => void handleUsersFileAction(event, 'add')}
            />
            <input
              ref={removeUsersInputRef}
              className="hidden-file-input"
              type="file"
              accept=".xls,.xlsx"
              onChange={(event) => void handleUsersFileAction(event, 'remove')}
            />
          </div>
        </div>
      </div>

      {summary?.audienceTeams.length ? (
        <div className="mission-audience-tags">
          {summary.audienceTeams.map((team) => (
            <span key={`${summary.id}-${team.id}`} className="mission-audience-tag">
              {team.name}
            </span>
          ))}
        </div>
      ) : summary ? (
        <p className="mission-empty">
          Audiencia desta missao ainda nao foi mapeada no prototipo.
        </p>
      ) : null}

      {members.length ? (
        <div className="team-table-wrap">
          <table className="team-table">
            <thead>
              <tr>
                <th>Matricula</th>
                <th>Nome</th>
                <th>Status</th>
                <th>Progresso</th>
                <th>Conclusao</th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => (
                <tr key={`${missionId}-${member.id}`}>
                  <td>{member.username ?? '-'}</td>
                  <td>{member.name}</td>
                  <td>
                    <span
                      className={`status-chip ${getMissionMemberStatusClass(member.missionStatus)}`}
                    >
                      {formatMissionMemberStatus(member.missionStatus)}
                    </span>
                  </td>
                  <td>
                    {member.progressPercentage !== null
                      ? `${member.progressPercentage}%`
                      : '-'}
                  </td>
                  <td>{member.completedAtLabel ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {members.length > TEAM_PAGE_SIZE ? (
            <div className="table-pagination">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
              >
                Anterior
              </button>
              <span>
                Pagina {page} de {totalPages}
              </span>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setPage((current) => Math.min(totalPages, current + 1))
                }
                disabled={page === totalPages}
              >
                Proxima
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mission-empty">
          Clique em `Carregar associados` para ver as pessoas ligadas a esta missao.
        </p>
      )}

      {!canManage ? (
        <p className="upload-feedback">Perfil de visualizacao: acoes de edicao estao bloqueadas.</p>
      ) : null}
      {feedback ? <p className="upload-feedback">{feedback}</p> : null}
    </div>
  )
}

function CollaboratorMissionTable({
  data,
  collaborators,
  isLoading,
  error,
  canManage,
  feedback,
  editingMatricula,
  onStartEdit,
  onCancelEdit,
  onCreateCollaborator,
  onUpdateCollaborator,
  onDeleteCollaborator,
  onImportCollaborators,
}: {
  data: CollaboratorMissionMatrix | null
  collaborators: CollaboratorRecord[]
  isLoading: boolean
  error: string | null
  canManage: boolean
  feedback: string | null
  editingMatricula: string | null
  onStartEdit: (matricula: string) => void
  onCancelEdit: () => void
  onCreateCollaborator: (record: CollaboratorRecord) => void
  onUpdateCollaborator: (originalMatricula: string, record: CollaboratorRecord) => void
  onDeleteCollaborator: (matricula: string) => void
  onImportCollaborators: (records: CollaboratorRecord[]) => Promise<void>
}) {
  const [page, setPage] = useState(1)
  const [newMatricula, setNewMatricula] = useState('')
  const [newNome, setNewNome] = useState('')
  const [search, setSearch] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  if (isLoading) {
    return <p className="mission-empty">Carregando colaboradores...</p>
  }

  if (error) {
    return <p className="feedback-banner">{error}</p>
  }

  if (!data) {
    return <p className="mission-empty">Nenhum dado carregado.</p>
  }

  const rows = collaborators
    .map((collaborator) => ({
      ...collaborator,
      assigned: Boolean(
        data.collaborators.find((item) => item.matricula === collaborator.matricula)?.teamNames
          .length,
      ),
    }))
    .filter((row) => {
      const term = search.trim().toLowerCase()

      if (!term) {
        return true
      }

      return (
        row.nome.toLowerCase().includes(term) ||
        row.matricula.toLowerCase().includes(term)
      )
    })
  const totalPages = Math.max(1, Math.ceil(rows.length / COLLABORATOR_PAGE_SIZE))
  const startIndex = (page - 1) * COLLABORATOR_PAGE_SIZE
  const visibleRows = rows.slice(
    startIndex,
    startIndex + COLLABORATOR_PAGE_SIZE,
  )

  return (
    <div className="team-table-wrap">
      {canManage ? (
        <div className="access-user-card">
          <div className="access-inputs">
            <input
              className="audience-select"
              value={newMatricula}
              onChange={(event) => setNewMatricula(event.target.value)}
              placeholder="Matricula"
            />
            <input
              className="audience-select"
              value={newNome}
              onChange={(event) => setNewNome(event.target.value)}
              placeholder="Nome"
            />
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                onCreateCollaborator({ matricula: newMatricula, nome: newNome })
                setNewMatricula('')
                setNewNome('')
              }}
            >
              Adicionar colaborador
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => downloadCollaboratorsDb(collaborators)}
            >
              Baixar banco de colaboradores
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => importInputRef.current?.click()}
            >
              Importar lista semanal de ativos
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xls,.xlsx"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0]

                if (!file) {
                  return
                }

                try {
                  const importedRows = await readCollaboratorsFromWorkbook(file)
                  await onImportCollaborators(importedRows)
                } finally {
                  event.currentTarget.value = ''
                }
              }}
            />
          </div>
        </div>
      ) : null}

      {feedback ? <p className="upload-feedback">{feedback}</p> : null}

      <div className="access-user-card">
        <div className="access-inputs">
          <input
            className="audience-select"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setPage(1)
            }}
            placeholder="Buscar por matricula ou nome"
          />
        </div>
      </div>

      <table className="team-table">
        <thead>
          <tr>
            <th>Matricula</th>
            <th>Nome</th>
            <th>Status</th>
            {canManage ? <th>Acoes</th> : null}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <CollaboratorRow
              key={row.matricula}
              row={row}
              canManage={canManage}
              isEditing={editingMatricula === row.matricula}
              onStartEdit={onStartEdit}
              onCancelEdit={onCancelEdit}
              onUpdateCollaborator={onUpdateCollaborator}
              onDeleteCollaborator={onDeleteCollaborator}
            />
          ))}
        </tbody>
      </table>

      <div className="table-pagination">
        <button
          className="secondary-button"
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={page === 1}
        >
          Anterior
        </button>
        <span>
          Pagina {page} de {totalPages}
        </span>
        <button
          className="secondary-button"
          type="button"
          onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          disabled={page === totalPages}
        >
          Proxima
        </button>
      </div>
    </div>
  )
}

function CollaboratorRow({
  row,
  canManage,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onUpdateCollaborator,
  onDeleteCollaborator,
}: {
  row: CollaboratorRecord & { assigned: boolean }
  canManage: boolean
  isEditing: boolean
  onStartEdit: (matricula: string) => void
  onCancelEdit: () => void
  onUpdateCollaborator: (originalMatricula: string, record: CollaboratorRecord) => void
  onDeleteCollaborator: (matricula: string) => void
}) {
  const [matricula, setMatricula] = useState(row.matricula)
  const [nome, setNome] = useState(row.nome)

  useEffect(() => {
    setMatricula(row.matricula)
    setNome(row.nome)
  }, [row])

  if (isEditing) {
    return (
      <tr>
        <td>
          <input
            className="audience-select"
            value={matricula}
            onChange={(event) => setMatricula(event.target.value)}
          />
        </td>
        <td>
          <input
            className="audience-select"
            value={nome}
            onChange={(event) => setNome(event.target.value)}
          />
        </td>
        <td>
          <span className={`status-chip ${row.assigned ? 'is-completed' : 'is-pending'}`}>
            {row.assigned ? 'Atribuido' : 'Nao atribuido'}
          </span>
        </td>
        <td>
          <div className="team-action-group">
            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                onUpdateCollaborator(row.matricula, {
                  matricula,
                  nome,
                })
              }
            >
              Salvar
            </button>
            <button className="secondary-button" type="button" onClick={onCancelEdit}>
              Cancelar
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{row.matricula}</td>
      <td>{row.nome}</td>
      <td>
        <span className={`status-chip ${row.assigned ? 'is-completed' : 'is-pending'}`}>
          {row.assigned ? 'Atribuido' : 'Nao atribuido'}
        </span>
      </td>
      {canManage ? (
        <td>
          <div className="team-action-group">
            <button
              className="secondary-button"
              type="button"
              onClick={() => onStartEdit(row.matricula)}
            >
              Editar
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onDeleteCollaborator(row.matricula)}
            >
              Excluir
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  )
}

function CollaboratorMissionMatrixTable({
  data,
  isLoading,
  error,
}: {
  data: CollaboratorMissionMatrix | null
  isLoading: boolean
  error: string | null
}) {
  if (isLoading) {
    return <p className="mission-empty">Carregando a matriz de missoes...</p>
  }

  if (error) {
    return <p className="feedback-banner">{error}</p>
  }

  if (!data) {
    return <p className="mission-empty">Nenhum dado carregado.</p>
  }

  return (
    <div className="matrix-table-wrap">
      <table className="team-table matrix-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Matricula</th>
            {data.missions.map((mission) => (
              <th key={mission.id}>{mission.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.collaborators.map((row) => (
            <tr key={`matrix-${row.matricula}`}>
              <td>
                <strong>{row.name}</strong>
              </td>
              <td>{row.matricula}</td>
              {data.missions.map((mission) => (
                <td key={`${row.matricula}-${mission.id}`} className="matrix-cell">
                  {row.missionNames.includes(mission.name) ? 'X' : ''}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function AccessLoginPanel({
  error,
  onSignIn,
}: {
  error: string | null
  onSignIn: (username: string, password: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  return (
    <div className="access-form">
      <div className="access-inputs">
        <input
          className="audience-select"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Usuario"
        />
        <input
          className="audience-select"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Senha"
        />
        <button
          className="primary-button"
          type="button"
          onClick={() => onSignIn(username.trim(), password)}
        >
          Entrar
        </button>
      </div>

      {error ? <p className="feedback-banner">{error}</p> : null}
    </div>
  )
}

function AccessUsersPanel({
  currentUser,
  users,
  canManageUsers,
  editingUserId,
  onCreateUser,
  onStartEditUser,
  onCancelEditUser,
  onUpdateUser,
  onDeleteUser,
}: {
  currentUser: AccessUser | null
  users: AccessUser[]
  canManageUsers: boolean
  editingUserId: string | null
  onCreateUser: (input: {
    name: string
    username: string
    password: string
    role: AccessUser['role']
  }) => void
  onStartEditUser: (userId: string) => void
  onCancelEditUser: () => void
  onUpdateUser: (
    userId: string,
    input: {
      name: string
      username: string
      password: string
      role: AccessUser['role']
    },
  ) => void
  onDeleteUser: (userId: string) => void
}) {
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<AccessUser['role']>('viewer')

  function submit() {
    onCreateUser({
      name,
      username,
      password,
      role,
    })
    setName('')
    setUsername('')
    setPassword('')
    setRole('viewer')
  }

  return (
    <div className="access-grid">
      <div className="access-form card">
        <h4>Usuario atual</h4>
        <p>
          {currentUser
            ? `${currentUser.name} (${formatAccessRoleLabel(currentUser.role)})`
            : 'Nenhum usuario autenticado.'}
        </p>

        {canManageUsers ? (
          <div className="access-inputs">
            <input
              className="audience-select"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome"
            />
            <input
              className="audience-select"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="Usuario"
            />
            <input
              className="audience-select"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Senha"
            />
            <select
              className="audience-select"
              value={role}
              onChange={(event) => setRole(event.target.value as AccessUser['role'])}
            >
              <option value="admin_plus">Admin Plus</option>
              <option value="admin">Admin</option>
              <option value="viewer">Visualizacao</option>
            </select>
            <button className="primary-button" type="button" onClick={submit}>
              Criar usuario
            </button>
          </div>
        ) : (
          <p className="mission-empty">
            Somente Admin Plus pode criar usuarios do prototipo.
          </p>
        )}
      </div>

      <div className="entity-list">
        {users.map((user) => (
          <AccessUserRow
            key={user.id}
            user={user}
            isEditing={editingUserId === user.id}
            canManageUsers={canManageUsers}
            onStartEditUser={onStartEditUser}
            onCancelEditUser={onCancelEditUser}
            onUpdateUser={onUpdateUser}
            onDeleteUser={onDeleteUser}
          />
        ))}
      </div>
    </div>
  )
}

function AccessUserRow({
  user,
  isEditing,
  canManageUsers,
  onStartEditUser,
  onCancelEditUser,
  onUpdateUser,
  onDeleteUser,
}: {
  user: AccessUser
  isEditing: boolean
  canManageUsers: boolean
  onStartEditUser: (userId: string) => void
  onCancelEditUser: () => void
  onUpdateUser: (
    userId: string,
    input: {
      name: string
      username: string
      password: string
      role: AccessUser['role']
    },
  ) => void
  onDeleteUser: (userId: string) => void
}) {
  const [name, setName] = useState(user.name)
  const [username, setUsername] = useState(user.username)
  const [password, setPassword] = useState(user.password)
  const [role, setRole] = useState<AccessUser['role']>(user.role)

  useEffect(() => {
    setName(user.name)
    setUsername(user.username)
    setPassword(user.password)
    setRole(user.role)
  }, [user])

  if (isEditing) {
    return (
      <div className="access-user-card">
        <div className="access-inputs">
          <input
            className="audience-select"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome"
          />
          <input
            className="audience-select"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Usuario"
          />
          <input
            className="audience-select"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha"
          />
          <select
            className="audience-select"
            value={role}
            onChange={(event) => setRole(event.target.value as AccessUser['role'])}
          >
            <option value="admin_plus">Admin Plus</option>
            <option value="admin">Admin</option>
            <option value="viewer">Visualizacao</option>
          </select>
          <button
            className="primary-button"
            type="button"
            onClick={() =>
              onUpdateUser(user.id, {
                name,
                username,
                password,
                role,
              })
            }
          >
            Salvar
          </button>
          <button className="secondary-button" type="button" onClick={onCancelEditUser}>
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="entity-item">
      <div className="entity-main">
        <strong>{user.name}</strong>
        <p>{user.username}</p>
      </div>
      <div className="entity-meta">
        <span>{formatAccessRoleLabel(user.role)}</span>
        <span>{user.description}</span>
        {canManageUsers ? (
          <>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onStartEditUser(user.id)}
            >
              Editar
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onDeleteUser(user.id)}
            >
              Excluir
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function downloadMissionAudienceMembers(
  missionName: string,
  members: MissionAudienceSummary['members'],
) {
  const rows = members
    .map(
      (member) =>
        `<tr><td>${escapeHtml(member.username ?? '-')}</td><td>${escapeHtml(member.name)}</td><td>${escapeHtml(formatMissionMemberStatus(member.missionStatus))}</td><td>${escapeHtml(member.progressPercentage !== null ? `${member.progressPercentage}%` : '-')}</td><td>${escapeHtml(member.completedAtLabel ?? '-')}</td></tr>`,
    )
    .join('')

  const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <table>
      <tr><th>Matricula</th><th>Nome</th><th>Status</th><th>Progresso</th><th>Conclusao</th></tr>
      ${rows}
    </table>
  </head>
  <body></body>
</html>`

  const blob = new Blob([content], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(missionName)}.xls`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadCollaboratorMissionMatrix(data: CollaboratorMissionMatrix) {
  const header = data.missions
    .map((mission) => `<th>${escapeHtml(mission.name)}</th>`)
    .join('')
  const rows = data.collaborators
    .map((row) => {
      const marks = data.missions
        .map((mission) => `<td>${row.missionNames.includes(mission.name) ? 'X' : ''}</td>`)
        .join('')

      return `<tr><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.matricula)}</td>${marks}</tr>`
    })
    .join('')

  const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <table>
      <tr><th>Nome</th><th>Matricula</th>${header}</tr>
      ${rows}
    </table>
  </head>
  <body></body>
</html>`

  downloadHtmlTableAsXls('matriz-de-missoes', content)
}

function downloadCollaboratorsDb(collaborators: CollaboratorRecord[]) {
  const rows = collaborators
    .map(
      (row) =>
        `<tr><td>${escapeHtml(row.matricula)}</td><td>${escapeHtml(row.nome)}</td></tr>`,
    )
    .join('')

  const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <table>
      <tr><th>Matricula</th><th>Nome</th></tr>
      ${rows}
    </table>
  </head>
  <body></body>
</html>`

  downloadHtmlTableAsXls('banco-de-colaboradores', content)
}

async function handleDownloadAllReports(
  setIsExportingReports: React.Dispatch<React.SetStateAction<boolean>>,
) {
  setIsExportingReports(true)

  try {
    const rows = await fetchAllMissionReportRows()
    const contentRows = rows
      .map(
        (row) =>
          `<tr><td>${escapeHtml(row.matricula)}</td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.missionId)}</td><td>${escapeHtml(formatMissionMemberStatus(row.status))}</td><td>${escapeHtml(row.completedAtLabel ?? '-')}</td><td>${escapeHtml(row.missionName)}</td></tr>`,
      )
      .join('')

    const content = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <table>
      <tr><th>Matricula</th><th>Nome</th><th>ID da Missao</th><th>Status da Missao</th><th>Data de Conclusao</th><th>Nome da Missao</th></tr>
      ${contentRows}
    </table>
  </head>
  <body></body>
</html>`

    downloadHtmlTableAsXls('relatorios-gerais-missoes', content)
  } finally {
    setIsExportingReports(false)
  }
}

function downloadHtmlTableAsXls(fileName: string, content: string) {
  const blob = new Blob([content], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(fileName)}.xls`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function getInitialAccessUser() {
  return getInitialAccessUserFromList(getStoredAccessUsers())
}

function persistAccessUser(user: AccessUser) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACCESS_SESSION_KEY, user.username)
}

function clearPersistedAccessUser() {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.removeItem(ACCESS_SESSION_KEY)
}

function getStoredAccessUsers() {
  if (typeof window === 'undefined') {
    return defaultAccessUsers
  }

  const raw = window.localStorage.getItem(ACCESS_USERS_KEY)

  if (!raw) {
    window.localStorage.setItem(ACCESS_USERS_KEY, JSON.stringify(defaultAccessUsers))
    return defaultAccessUsers
  }

  try {
    return JSON.parse(raw) as AccessUser[]
  } catch {
    return defaultAccessUsers
  }
}

function persistAccessUsers(users: AccessUser[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(ACCESS_USERS_KEY, JSON.stringify(users))
}

function getInitialAccessUserFromList(users: AccessUser[]) {
  if (typeof window === 'undefined') {
    return null
  }

  const storedUsername = window.localStorage.getItem(ACCESS_SESSION_KEY)

  if (!storedUsername) {
    return null
  }

  return users.find((user) => user.username === storedUsername) ?? null
}

function formatAccessRoleLabel(role?: AccessUser['role']) {
  switch (role) {
    case 'admin_plus':
      return 'Admin Plus'
    case 'admin':
      return 'Admin'
    case 'viewer':
      return 'Visualizacao'
    default:
      return 'Sem sessao'
  }
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatMissionMemberStatus(status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED') {
  switch (status) {
    case 'COMPLETED':
      return 'Concluido'
    case 'IN_PROGRESS':
      return 'Em andamento'
    default:
      return 'Nao iniciado'
  }
}

function getMissionMemberStatusClass(
  status: 'COMPLETED' | 'IN_PROGRESS' | 'NOT_STARTED',
) {
  switch (status) {
    case 'COMPLETED':
      return 'is-completed'
    case 'IN_PROGRESS':
      return 'is-progress'
    default:
      return 'is-pending'
  }
}


async function readMatriculasFromWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
  })

  return rows
    .slice(1)
    .map((row) => String(row[0] ?? '').trim())
    .filter(Boolean)
}

async function readCollaboratorsFromWorkbook(file: File) {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const firstSheetName = workbook.SheetNames[0]
  const worksheet = workbook.Sheets[firstSheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(worksheet, {
    header: 1,
    raw: false,
  })

  const imported = rows
    .slice(1)
    .map((row) => {
      const matricula = String(row[0] ?? '').trim()
      const nome = String(row[1] ?? '').trim()
      const status = String(row[17] ?? '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()

      return {
        matricula,
        nome,
        status,
      }
    })
    .filter((row) => row.matricula && row.nome && row.status === 'ativo')
    .map((row) => ({
      matricula: row.matricula,
      nome: row.nome,
    }))

  if (!imported.length) {
    throw new Error(
      'Nenhum colaborador ativo foi encontrado no arquivo. Use A = Numero Pessoal, B = Nome e R = Status com valor Ativo.',
    )
  }

  return imported
}

function getStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.localStorage.getItem(key)

  if (value === null) {
    return fallback
  }

  return value === 'true'
}

function getStoredTimes(key: string, fallback: string[]) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return fallback
  }

  try {
    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return fallback
    }

    const normalized = parsed
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)
      .slice(0, 3)

    return normalized.length === 3 ? normalized : fallback
  } catch {
    return fallback
  }
}

function getStoredTime(key: string, fallback: string) {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.localStorage.getItem(key)

  if (!value || !parseTimeValue(value)) {
    return fallback
  }

  return value
}

function readStoredRunMap(key: string) {
  if (typeof window === 'undefined') {
    return {} as Record<string, string>
  }

  const raw = window.localStorage.getItem(key)

  if (!raw) {
    return {} as Record<string, string>
  }

  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {} as Record<string, string>
  }
}

function parseTimeValue(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/)

  if (!match) {
    return null
  }

  return {
    hours: Number(match[1]),
    minutes: Number(match[2]),
  }
}

function getTodayStamp(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDateTimeNow() {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
}

function NavIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'grid':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1.5" />
          <rect x="14" y="4" width="6" height="6" rx="1.5" />
          <rect x="4" y="14" width="6" height="6" rx="1.5" />
          <rect x="14" y="14" width="6" height="6" rx="1.5" />
        </svg>
      )
    case 'book':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H20v15H7.5A2.5 2.5 0 0 0 5 21V6.5Z" />
          <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H20" />
        </svg>
      )
    case 'users':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 18a5.5 5.5 0 0 1 11 0" />
          <circle cx="17.5" cy="9" r="2.5" />
          <path d="M15 18a4.5 4.5 0 0 1 6 0" />
        </svg>
      )
    case 'table':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M4 10h16M10 4v16M16 4v16" />
        </svg>
      )
    case 'flow':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="2" />
          <rect x="14" y="14" width="6" height="6" rx="2" />
          <path d="M10 7h4a2 2 0 0 1 2 2v5" />
          <path d="M8 14H4" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M7 4h7l5 5v11H7z" />
          <path d="M14 4v5h5M9 13h6M9 17h6" />
        </svg>
      )
  }
}

function ExitIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H5" />
      <path d="M15 5h4v14h-4" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M3 12h2.2M18.8 12H21M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  )
}

export default App
