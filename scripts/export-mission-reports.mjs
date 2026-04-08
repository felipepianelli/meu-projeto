import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const missionCatalogPath = path.join(rootDir, 'src', 'data', 'missionAudienceCatalog.ts')
const envLocalPath = path.join(rootDir, '.env.local')
const exportsDir = path.join(rootDir, 'exports')
const reportsHistoryDir = path.join(exportsDir, 'historico')

function readEnvValue(key) {
  if (!fs.existsSync(envLocalPath)) {
    return ''
  }

  const lines = fs.readFileSync(envLocalPath, 'utf8').split(/\r?\n/)
  const line = lines.find((item) => item.startsWith(`${key}=`))
  return line ? line.slice(key.length + 1).trim() : ''
}

function loadMissionCatalog() {
  const source = fs.readFileSync(missionCatalogPath, 'utf8')
  const match = source.match(
    /export const missionAudienceCatalog:\s*MissionAudienceDefinition\[\]\s*=\s*(\[[\s\S]*?\n\])/,
  )

  if (!match?.[1]) {
    throw new Error('Nao foi possivel carregar o catalogo de missoes.')
  }

  return Function(`"use strict"; return (${match[1]});`)()
}

function getBearerHeaders(token) {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

function getRawTokenHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: token,
  }
}

async function readJson(url, init) {
  const response = await fetch(url, init)

  if (!response.ok) {
    throw new Error(`Falha na requisicao (${response.status}) para ${url}`)
  }

  return response.json()
}

async function fetchMissionEnrollmentsByStatus(missionId, status, token) {
  const results = []
  let offset = null

  do {
    const url = new URL(`https://mission.learningrocks.io/enrollments/by_mission/${missionId}`)
    url.searchParams.set('limit', '100')
    url.searchParams.set('enrollment_status', status)

    if (offset) {
      url.searchParams.set('offset', offset)
    }

    const payload = await readJson(url.toString(), {
      headers: getBearerHeaders(token),
    })

    results.push(...(payload.results ?? []))
    offset = payload.offset ?? null
  } while (offset)

  return results
}

async function fetchUserDetail(userId, token, cache) {
  if (cache.has(userId)) {
    return cache.get(userId)
  }

  const request = readJson(`https://knowledge.skore.io/workspace/v1/users/${userId}`, {
    headers: getRawTokenHeaders(token),
  }).catch(() => null)

  cache.set(userId, request)
  return request
}

async function fetchMembersForTeam(teamId, token, userCache) {
  const team = await readJson(`https://user.skore.ai/v1/teams/${teamId}`, {
    headers: getBearerHeaders(token),
  })

  const userIds = Array.from(new Set(team.userIds ?? []))

  if (!userIds.length) {
    return []
  }

  const users = await Promise.all(userIds.map((userId) => fetchUserDetail(String(userId), token, userCache)))

  return users
    .filter(Boolean)
    .map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username ?? null,
    }))
}

function formatTimestampLabel(timestamp) {
  if (!timestamp || Number.isNaN(timestamp)) {
    return null
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function buildDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((item) => item.type !== 'literal')
      .map((item) => [item.type, item.value]),
  )

  return {
    dateStamp: `${parts.year}${parts.month}${parts.day}`,
    timeStamp: `${parts.hour}${parts.minute}`,
  }
}

async function fetchMissionAudienceMembers(mission, token, userCache) {
  const teams = mission.audience.filter((item) => item.type === 'team')
  const teamMembers = await Promise.all(
    teams.map((team) => fetchMembersForTeam(Number(team.id), token, userCache)),
  )

  const memberMap = new Map(
    teamMembers
      .flat()
      .filter(Boolean)
      .map((member) => [member.id, member]),
  )

  const [completedEnrollments, inProgressEnrollments] = await Promise.all([
    fetchMissionEnrollmentsByStatus(mission.id, 'COMPLETED', token),
    fetchMissionEnrollmentsByStatus(mission.id, 'IN_PROGRESS', token),
  ])

  const enrollmentUserIds = Array.from(
    new Set([...completedEnrollments, ...inProgressEnrollments].map((item) => item.user_id)),
  )

  const unresolvedUserIds = enrollmentUserIds.filter((userId) => !memberMap.has(Number(userId)))
  const unresolvedUsers = await Promise.all(
    unresolvedUserIds.map((userId) => fetchUserDetail(String(userId), token, userCache)),
  )

  unresolvedUsers.forEach((user) => {
    if (!user) {
      return
    }

    memberMap.set(user.id, {
      id: user.id,
      name: user.name,
      username: user.username ?? null,
    })
  })

  const enrollmentByUserId = new Map()
  completedEnrollments.forEach((item) => enrollmentByUserId.set(item.user_id, item))
  inProgressEnrollments.forEach((item) => {
    if (!enrollmentByUserId.has(item.user_id)) {
      enrollmentByUserId.set(item.user_id, item)
    }
  })

  return Array.from(memberMap.values())
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .map((member) => {
      const enrollment = enrollmentByUserId.get(String(member.id))

      if (!enrollment) {
        return {
          matricula: member.username ?? '-',
          name: member.name,
          missionId: mission.id,
          missionName: mission.name,
          status: 'NOT_STARTED',
          completedAtLabel: null,
        }
      }

      return {
        matricula: member.username ?? '-',
        name: member.name,
        missionId: mission.id,
        missionName: mission.name,
        status: enrollment.status,
        completedAtLabel: enrollment.completed_at ? formatTimestampLabel(enrollment.completed_at) : null,
      }
    })
}

async function main() {
  const token = readEnvValue('VITE_SKORE_API_TOKEN')

  if (!token) {
    throw new Error('VITE_SKORE_API_TOKEN nao encontrado no .env.local.')
  }

  const missionCatalog = loadMissionCatalog()
  const userCache = new Map()
  const rows = []

  for (const mission of missionCatalog) {
    const missionRows = await fetchMissionAudienceMembers(mission, token, userCache)
    rows.push(...missionRows)
  }

  rows.sort((a, b) => {
    if (a.matricula === b.matricula) {
      return a.missionName.localeCompare(b.missionName, 'pt-BR')
    }

    return a.matricula.localeCompare(b.matricula, 'pt-BR')
  })

  fs.mkdirSync(exportsDir, { recursive: true })
  fs.mkdirSync(reportsHistoryDir, { recursive: true })
  const { dateStamp, timeStamp } = buildDateParts()

  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(
    rows.map((row) => ({
      Matricula: row.matricula,
      Nome: row.name,
      'ID da Missao': row.missionId,
      'Status da Missao': row.status,
      'Data de Conclusao': row.completedAtLabel ?? '-',
      'Nome da Missao': row.missionName,
    })),
  )

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatorio')

  const fixedOutputPath = path.join(exportsDir, 'relatorios-gerais-missoes.xlsx')
  const historyOutputPath = path.join(
    reportsHistoryDir,
    `relatorios-gerais-missoes-${dateStamp}-${timeStamp}.xlsx`,
  )
  XLSX.writeFile(workbook, fixedOutputPath)
  XLSX.writeFile(workbook, historyOutputPath)

  console.log(`Relatorio fixo gerado em: ${fixedOutputPath}`)
  console.log(`Copia historica gerada em: ${historyOutputPath}`)
  console.log(`Total de linhas exportadas: ${rows.length}`)
}

main().catch((error) => {
  console.error('Falha ao gerar relatorio automatico:', error)
  process.exit(1)
})
