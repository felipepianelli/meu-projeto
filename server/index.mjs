import cors from 'cors'
import express from 'express'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server as SocketServer } from 'socket.io'
import { createClient } from '@supabase/supabase-js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dbPath =
  process.env.COLLABORATORS_DB_PATH ||
  path.join(__dirname, 'data', 'collaborators-db.json')
const dbDir = path.dirname(dbPath)
const teamCacheDbPath =
  process.env.TEAM_CACHE_DB_PATH ||
  path.join(__dirname, 'data', 'team-members-cache-db.json')
const teamCacheDbDir = path.dirname(teamCacheDbPath)
const collaboratorsSeedPath = path.join(rootDir, 'src', 'data', 'collaborators.json')
const parsedPort = Number(process.env.PORT)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3030
const host = process.env.HOST || '0.0.0.0'
const supabaseUrl = process.env.SUPABASE_URL?.trim() || ''
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || ''
const collaboratorsTable = process.env.SUPABASE_COLLABORATORS_TABLE?.trim() || 'collaborators'
const teamCacheTable = process.env.SUPABASE_TEAM_CACHE_TABLE?.trim() || 'team_member_cache'
const skoreApiToken =
  process.env.SKORE_API_TOKEN?.trim() || process.env.VITE_SKORE_API_TOKEN?.trim() || ''
const skoreUsersUrl =
  process.env.SKORE_USERS_URL?.trim() ||
  process.env.VITE_SKORE_USERS_URL?.trim() ||
  'https://knowledge.skore.io/workspace/v2/users'
const teamAuditCacheTtlMs = 5 * 60 * 1000
const collaboratorAuditBatchSize = 12

fs.mkdirSync(dbDir, { recursive: true })
fs.mkdirSync(teamCacheDbDir, { recursive: true })

const usingSupabase = Boolean(supabaseUrl && supabaseServiceRoleKey)
const supabase = usingSupabase
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null
let activeUsersAuditCache = {
  expiresAt: 0,
  promise: null,
}
let collaboratorUsersAuditCache = {
  expiresAt: 0,
  promise: null,
}

const app = express()
const httpServer = createServer(app)
const io = new SocketServer(httpServer, {
  cors: {
    origin: '*',
  },
})

app.set('trust proxy', 1)
app.use(
  cors({
    origin: '*',
  }),
)
app.use(express.json({ limit: '1mb' }))

function validateCollaborator(input) {
  const matricula = String(input?.matricula ?? '').trim()
  const nome = String(input?.nome ?? '').trim()

  if (!matricula) {
    return { error: 'A matricula e obrigatoria.' }
  }

  if (!nome) {
    return { error: 'O nome e obrigatorio.' }
  }

  return { matricula, nome }
}

function parseJsonFile(filePath) {
  const rawData = fs.readFileSync(filePath, 'utf8')
  const cleanData = rawData.replace(/^\uFEFF/, '')
  return JSON.parse(cleanData)
}

function readSeedRows() {
  const seedRows = parseJsonFile(collaboratorsSeedPath)

  return seedRows.map((row) => ({
    matricula: String(row.matricula ?? '').trim(),
    nome: String(row.nome ?? '').trim(),
  }))
}

function ensureFileDatabase() {
  if (fs.existsSync(dbPath)) {
    return
  }

  const timestamp = new Date().toISOString()
  const rows = readSeedRows()

  writeFileDatabase({
    updatedAt: timestamp,
    items: rows.map((row) => ({
      ...row,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  })
}

function readFileDatabase() {
  ensureFileDatabase()
  return parseJsonFile(dbPath)
}

function writeFileDatabase(database) {
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf8')
}

function ensureTeamCacheFileDatabase() {
  if (fs.existsSync(teamCacheDbPath)) {
    return
  }

  writeTeamCacheFileDatabase({
    updatedAt: new Date().toISOString(),
    items: [],
  })
}

function readTeamCacheFileDatabase() {
  ensureTeamCacheFileDatabase()
  return parseJsonFile(teamCacheDbPath)
}

function writeTeamCacheFileDatabase(database) {
  fs.writeFileSync(teamCacheDbPath, JSON.stringify(database, null, 2), 'utf8')
}

function mapTeamCacheItem(row) {
  return {
    teamId: Number(row.team_id ?? row.teamId),
    teamName: String(row.team_name ?? row.teamName ?? '').trim(),
    userId: Number(row.user_id ?? row.userId),
    matricula: String(row.matricula ?? '').trim(),
    nome: String(row.nome ?? '').trim(),
    source: String(row.source ?? 'manual').trim() || 'manual',
    updatedAt: row.updated_at ?? row.updatedAt ?? new Date().toISOString(),
  }
}

function isSupabaseMissingTableError(error) {
  return (
    error &&
    typeof error === 'object' &&
    (error.code === '42P01' ||
      String(error.message ?? '')
        .toLowerCase()
        .includes('relation') &&
      String(error.message ?? '')
        .toLowerCase()
        .includes('does not exist'))
  )
}

async function ensureSupabaseSeed() {
  if (!supabase) {
    return
  }

  const { count, error } = await supabase
    .from(collaboratorsTable)
    .select('*', { count: 'exact', head: true })

  if (error) {
    throw error
  }

  if ((count ?? 0) > 0) {
    return
  }

  const timestamp = new Date().toISOString()
  const seedRows = readSeedRows().map((row) => ({
    ...row,
    created_at: timestamp,
    updated_at: timestamp,
  }))

  const { error: insertError } = await supabase.from(collaboratorsTable).insert(seedRows)

  if (insertError) {
    throw insertError
  }
}

async function listCollaborators() {
  if (supabase) {
    const { data, error } = await supabase
      .from(collaboratorsTable)
      .select('matricula,nome,updated_at')
      .order('nome', { ascending: true })
      .order('matricula', { ascending: true })

    if (error) {
      throw error
    }

    return data ?? []
  }

  return readFileDatabase().items
    .slice()
    .sort((a, b) => {
      const nameDiff = a.nome.localeCompare(b.nome, 'pt-BR')

      if (nameDiff !== 0) {
        return nameDiff
      }

      return a.matricula.localeCompare(b.matricula, 'pt-BR')
    })
}

async function getCollaboratorsPayload() {
  const items = (await listCollaborators()).map((item) => ({
    matricula: item.matricula,
    nome: item.nome,
  }))

  if (supabase) {
    const { data, error } = await supabase
      .from(collaboratorsTable)
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) {
      throw error
    }

    return {
      items,
      total: items.length,
      updatedAt: data?.[0]?.updated_at ?? new Date().toISOString(),
    }
  }

  const database = readFileDatabase()

  return {
    items,
    total: items.length,
    updatedAt: database.updatedAt,
  }
}

async function getCollaboratorsPayloadForAudit() {
  try {
    return await getCollaboratorsPayload()
  } catch (error) {
    console.warn('Falha ao ler colaboradores do banco para auditoria. Usando seed local.', error)

    const seedRows = readSeedRows()

    return {
      items: seedRows,
      total: seedRows.length,
      updatedAt: new Date().toISOString(),
    }
  }
}

async function listTeamCacheMembers(options = {}) {
  const teamId = Number(options.teamId)

  if (supabase) {
    let query = supabase
      .from(teamCacheTable)
      .select('team_id,team_name,user_id,matricula,nome,source,updated_at')
      .order('team_name', { ascending: true })
      .order('nome', { ascending: true })

    if (Number.isFinite(teamId) && teamId > 0) {
      query = query.eq('team_id', teamId)
    }

    const { data, error } = await query

    if (error) {
      if (!isSupabaseMissingTableError(error)) {
        throw error
      }
    } else {
      return (data ?? []).map(mapTeamCacheItem)
    }
  }

  const database = readTeamCacheFileDatabase()
  const items = Array.isArray(database.items) ? database.items.map(mapTeamCacheItem) : []

  if (Number.isFinite(teamId) && teamId > 0) {
    return items.filter((item) => item.teamId === teamId)
  }

  return items
}

async function upsertTeamCacheMembers(teamId, teamName, members) {
  const normalizedItems = Array.from(
    new Map(
      members
        .map((item) => ({
          teamId,
          teamName: String(teamName ?? '').trim(),
          userId: Number(item?.userId),
          matricula: String(item?.matricula ?? '').trim(),
          nome: String(item?.nome ?? '').trim(),
          source: 'manual',
        }))
        .filter(
          (item) =>
            Number.isFinite(item.teamId) &&
            item.teamId > 0 &&
            Number.isFinite(item.userId) &&
            item.userId > 0 &&
            item.matricula &&
            item.nome,
        )
        .map((item) => [`${item.teamId}:${item.matricula}`, item]),
    ).values(),
  )

  if (!normalizedItems.length) {
    throw new Error('Nenhum participante valido foi enviado para o cache do time.')
  }

  const timestamp = new Date().toISOString()

  if (supabase) {
    const existingRows = await listTeamCacheMembers({ teamId })
    const rowsToKeep = existingRows.filter(
      (item) => !normalizedItems.some((candidate) => candidate.matricula === item.matricula),
    )

    const replaceRows = [
      ...rowsToKeep.map((item) => ({
        team_id: item.teamId,
        team_name: item.teamName,
        user_id: item.userId,
        matricula: item.matricula,
        nome: item.nome,
        source: item.source,
        updated_at: item.updatedAt,
      })),
      ...normalizedItems.map((item) => ({
        team_id: item.teamId,
        team_name: item.teamName,
        user_id: item.userId,
        matricula: item.matricula,
        nome: item.nome,
        source: item.source,
        updated_at: timestamp,
      })),
    ]

    const { error: deleteError } = await supabase.from(teamCacheTable).delete().eq('team_id', teamId)

    if (deleteError && !isSupabaseMissingTableError(deleteError)) {
      throw deleteError
    }

    if (!isSupabaseMissingTableError(deleteError)) {
      const { error: insertError } = await supabase.from(teamCacheTable).insert(replaceRows)

      if (insertError) {
        throw insertError
      }

      return normalizedItems.map((item) => ({
        ...item,
        updatedAt: timestamp,
      }))
    }
  }

  const database = readTeamCacheFileDatabase()
  const currentItems = Array.isArray(database.items) ? database.items.map(mapTeamCacheItem) : []
  const rowsToKeep = currentItems.filter(
    (item) =>
      item.teamId !== teamId ||
      !normalizedItems.some((candidate) => candidate.matricula === item.matricula),
  )

  database.items = [
    ...rowsToKeep.map((item) => ({
      teamId: item.teamId,
      teamName: item.teamName,
      userId: item.userId,
      matricula: item.matricula,
      nome: item.nome,
      source: item.source,
      updatedAt: item.updatedAt,
    })),
    ...normalizedItems.map((item) => ({
      teamId: item.teamId,
      teamName: item.teamName,
      userId: item.userId,
      matricula: item.matricula,
      nome: item.nome,
      source: item.source,
      updatedAt: timestamp,
    })),
  ]
  database.updatedAt = timestamp
  writeTeamCacheFileDatabase(database)

  return normalizedItems.map((item) => ({
    ...item,
    updatedAt: timestamp,
  }))
}

async function emitCollaboratorsChanged() {
  const payload = await getCollaboratorsPayload()

  io.emit('collaborators:changed', {
    total: payload.total,
    updatedAt: payload.updatedAt,
  })
}

function getSkoreUsersHeaders() {
  if (!skoreApiToken) {
    throw new Error('SKORE_API_TOKEN nao configurado no backend.')
  }

  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: skoreApiToken,
  }
}

async function readJson(input, init) {
  const response = await fetch(input, init)

  if (!response.ok) {
    throw new Error(`Falha na requisicao (${response.status})`)
  }

  return response.json()
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

async function fetchUsersByMatriculasForAudit(matriculas) {
  const normalized = Array.from(new Set(matriculas.map((item) => String(item ?? '').trim()).filter(Boolean)))
  const results = []

  for (let index = 0; index < normalized.length; index += collaboratorAuditBatchSize) {
    const batch = normalized.slice(index, index + collaboratorAuditBatchSize)
    const settled = await Promise.allSettled(
      batch.map(async (matricula) => {
        const url = new URL(skoreUsersUrl)
        url.searchParams.set('username__eq', matricula)
        url.searchParams.set('find_exact_match', 'true')
        url.searchParams.set('limit', '2')
        url.searchParams.set('active', 'true')

        const payload = await readJson(url.toString(), {
          headers: getSkoreUsersHeaders(),
        })

        return payload.results?.[0] ?? null
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

async function fetchCollaboratorUsersForAudit(options = {}) {
  const refresh = Boolean(options.refresh)
  const now = Date.now()

  if (!refresh && collaboratorUsersAuditCache.promise && collaboratorUsersAuditCache.expiresAt > now) {
    return collaboratorUsersAuditCache.promise
  }

  const request = (async () => {
    const collaboratorsPayload = await getCollaboratorsPayloadForAudit()
    const collaboratorNamesByMatricula = new Map(
      collaboratorsPayload.items.map((item) => [item.matricula, item.nome]),
    )
    const users = await fetchUsersByMatriculasForAudit(
      collaboratorsPayload.items.map((item) => item.matricula),
    )

    return users.map((user) => ({
      ...user,
      resolvedName: collaboratorNamesByMatricula.get(user.username ?? '') || user.name || '-',
    }))
  })()

  collaboratorUsersAuditCache = {
    expiresAt: now + teamAuditCacheTtlMs,
    promise: request,
  }

  try {
    return await request
  } catch (error) {
    collaboratorUsersAuditCache = {
      expiresAt: 0,
      promise: null,
    }
    throw error
  }
}

async function buildTeamAuditCsv(teamId) {
  const users = await fetchCollaboratorUsersForAudit()
  const cachedMembers = await listTeamCacheMembers({ teamId })

  const liveMembers = users
    .filter((user) => Array.isArray(user.teams) && user.teams.some((team) => team.id === teamId))
    .map((user) => ({
      id: user.id,
      matricula: user.username ?? '-',
      nome: user.resolvedName,
      source: 'skore',
    }))

  const matchedUsers = [...liveMembers, ...cachedMembers.map((item) => ({
    id: item.userId,
    matricula: item.matricula,
    nome: item.nome,
    source: item.source,
  }))]
    .filter(
      (member, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.id === member.id || candidate.matricula === member.matricula,
        ) === index,
    )
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))

  const rows = [
    ['Matricula', 'Nome'],
    ...matchedUsers.map((member) => [member.matricula, member.nome]),
  ]

  return {
    count: matchedUsers.length,
    content: `\ufeffsep=;\n${rows.map((row) => row.map(escapeCsvValue).join(';')).join('\n')}`,
  }
}

async function createCollaboratorRecord({ matricula, nome }) {
  if (supabase) {
    const timestamp = new Date().toISOString()
    const { data, error } = await supabase
      .from(collaboratorsTable)
      .insert({
        matricula,
        nome,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .select('matricula,nome')
      .single()

    if (error) {
      if (error.code === '23505') {
        throw new Error('Ja existe um colaborador com essa matricula.')
      }

      throw error
    }

    return data
  }

  const database = readFileDatabase()
  const existing = database.items.find((item) => item.matricula === matricula)

  if (existing) {
    throw new Error('Ja existe um colaborador com essa matricula.')
  }

  const timestamp = new Date().toISOString()
  const row = {
    matricula,
    nome,
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  database.items.push(row)
  database.updatedAt = timestamp
  writeFileDatabase(database)

  return {
    matricula,
    nome,
  }
}

async function replaceCollaboratorsRecords(records) {
  const normalizedItems = Array.from(
    new Map(
      records
        .map((item) => ({
          matricula: String(item?.matricula ?? '').trim(),
          nome: String(item?.nome ?? '').trim(),
        }))
        .filter((item) => item.matricula && item.nome)
        .map((item) => [item.matricula, item]),
    ).values(),
  ).sort((a, b) => {
    const nameDiff = a.nome.localeCompare(b.nome, 'pt-BR')

    if (nameDiff !== 0) {
      return nameDiff
    }

    return a.matricula.localeCompare(b.matricula, 'pt-BR')
  })

  if (!normalizedItems.length) {
    throw new Error('A lista de colaboradores ativos veio vazia.')
  }

  if (supabase) {
    const { data: existingRows, error: existingError } = await supabase
      .from(collaboratorsTable)
      .select('matricula')

    if (existingError) {
      throw existingError
    }

    if (existingRows?.length) {
      const { error: deleteError } = await supabase
        .from(collaboratorsTable)
        .delete()
        .in(
          'matricula',
          existingRows.map((item) => item.matricula),
        )

      if (deleteError) {
        throw deleteError
      }
    }

    const timestamp = new Date().toISOString()
    const { error: insertError } = await supabase.from(collaboratorsTable).insert(
      normalizedItems.map((item) => ({
        matricula: item.matricula,
        nome: item.nome,
        created_at: timestamp,
        updated_at: timestamp,
      })),
    )

    if (insertError) {
      throw insertError
    }

    return normalizedItems
  }

  const timestamp = new Date().toISOString()
  writeFileDatabase({
    updatedAt: timestamp,
    items: normalizedItems.map((item) => ({
      matricula: item.matricula,
      nome: item.nome,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  })

  return normalizedItems
}

async function updateCollaboratorRecord(originalMatricula, { matricula, nome }) {
  if (supabase) {
    const { data: existing, error: existingError } = await supabase
      .from(collaboratorsTable)
      .select('matricula')
      .eq('matricula', originalMatricula)
      .maybeSingle()

    if (existingError) {
      throw existingError
    }

    if (!existing) {
      throw new Error('Colaborador nao encontrado.')
    }

    if (matricula !== originalMatricula) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from(collaboratorsTable)
        .select('matricula')
        .eq('matricula', matricula)
        .maybeSingle()

      if (duplicateError) {
        throw duplicateError
      }

      if (duplicate) {
        throw new Error('Ja existe um colaborador com essa matricula.')
      }
    }

    const { data, error } = await supabase
      .from(collaboratorsTable)
      .update({
        matricula,
        nome,
        updated_at: new Date().toISOString(),
      })
      .eq('matricula', originalMatricula)
      .select('matricula,nome')
      .single()

    if (error) {
      throw error
    }

    return data
  }

  const database = readFileDatabase()
  const existing = database.items.find((item) => item.matricula === originalMatricula)

  if (!existing) {
    throw new Error('Colaborador nao encontrado.')
  }

  const duplicate = database.items.find(
    (item) => item.matricula === matricula && item.matricula !== originalMatricula,
  )

  if (duplicate) {
    throw new Error('Ja existe um colaborador com essa matricula.')
  }

  const timestamp = new Date().toISOString()
  database.items = database.items.map((item) =>
    item.matricula === originalMatricula
      ? {
          ...item,
          matricula,
          nome,
          updatedAt: timestamp,
        }
      : item,
  )
  database.updatedAt = timestamp
  writeFileDatabase(database)

  return {
    matricula,
    nome,
  }
}

async function deleteCollaboratorRecord(matricula) {
  if (supabase) {
    const { data, error } = await supabase
      .from(collaboratorsTable)
      .delete()
      .eq('matricula', matricula)
      .select('matricula')

    if (error) {
      throw error
    }

    if (!data?.length) {
      throw new Error('Colaborador nao encontrado.')
    }

    return
  }

  const database = readFileDatabase()
  const nextItems = database.items.filter((item) => item.matricula !== matricula)

  if (nextItems.length === database.items.length) {
    throw new Error('Colaborador nao encontrado.')
  }

  database.items = nextItems
  database.updatedAt = new Date().toISOString()
  writeFileDatabase(database)
}

function mapErrorStatus(error) {
  const message = error instanceof Error ? error.message : 'Erro interno no servidor.'

  if (message === 'Ja existe um colaborador com essa matricula.') {
    return 409
  }

  if (message === 'Colaborador nao encontrado.') {
    return 404
  }

  if (message === 'A lista de colaboradores ativos veio vazia.') {
    return 400
  }

  if (message === 'Nenhum participante valido foi enviado para o cache do time.') {
    return 400
  }

  return 500
}

app.get('/health', async (_request, response, next) => {
  try {
    if (supabase) {
      await ensureSupabaseSeed()
    }

    const payload = await getCollaboratorsPayload()

    response.json({
      ok: true,
      service: 'skore-manager-collaborators',
      environment: process.env.NODE_ENV || 'development',
      port,
      storage: usingSupabase ? 'supabase' : 'file',
      totalCollaborators: payload.total,
    })
  } catch (error) {
    next(error)
  }
})

app.get('/', (_request, response) => {
  response.json({
    ok: true,
    service: 'skore-manager-collaborators',
    message: 'API online',
  })
})

app.get('/api/collaborators', async (_request, response, next) => {
  try {
    if (supabase) {
      await ensureSupabaseSeed()
    }

    response.json(await getCollaboratorsPayload())
  } catch (error) {
    next(error)
  }
})

app.get('/api/team-cache', async (request, response, next) => {
  try {
    const teamIdRaw = String(request.query.teamId ?? '').trim()
    const teamId = teamIdRaw ? Number(teamIdRaw) : undefined

    const items = await listTeamCacheMembers({
      teamId: Number.isFinite(teamId) ? teamId : undefined,
    })

    response.json({
      items,
      total: items.length,
      updatedAt: new Date().toISOString(),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/team-cache/upsert', async (request, response, next) => {
  try {
    const teamId = Number(request.body?.teamId)
    const teamName = String(request.body?.teamName ?? '').trim()
    const items = Array.isArray(request.body?.items) ? request.body.items : null

    if (!Number.isFinite(teamId) || teamId <= 0 || !teamName) {
      response.status(400).json({ error: 'Informe teamId e teamName validos.' })
      return
    }

    if (!items) {
      response.status(400).json({ error: 'Envie a lista em items.' })
      return
    }

    const persisted = await upsertTeamCacheMembers(teamId, teamName, items)

    response.status(200).json({
      total: persisted.length,
      item: {
        teamId,
        teamName,
      },
    })
  } catch (error) {
    const status = mapErrorStatus(error)

    if (status !== 500) {
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Erro interno no servidor.',
      })
      return
    }

    next(error)
  }
})

app.get('/api/team-audit/:teamId/csv', async (request, response, next) => {
  try {
    const teamId = Number(request.params.teamId)
    const teamName = String(request.query.teamName ?? `time-${teamId}`).trim() || `time-${teamId}`

    if (!Number.isFinite(teamId) || teamId <= 0) {
      response.status(400).json({ error: 'Team ID invalido.' })
      return
    }

    const { count, content } = await buildTeamAuditCsv(teamId)
    const safeName = teamName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || `time-${teamId}`

    response.setHeader('Content-Type', 'text/csv; charset=utf-8')
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}.csv"`,
    )
    response.setHeader('X-Team-Audit-Count', String(count))
    response.send(content)
  } catch (error) {
    next(error)
  }
})

app.post('/api/collaborators', async (request, response, next) => {
  try {
    const parsed = validateCollaborator(request.body)

    if ('error' in parsed) {
      response.status(400).json(parsed)
      return
    }

    const item = await createCollaboratorRecord(parsed)
    await emitCollaboratorsChanged()

    response.status(201).json({ item })
  } catch (error) {
    const status = mapErrorStatus(error)

    if (status !== 500) {
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Erro interno no servidor.',
      })
      return
    }

    next(error)
  }
})

app.post('/api/collaborators/import', async (request, response, next) => {
  try {
    const items = Array.isArray(request.body?.items) ? request.body.items : null

    if (!items) {
      response.status(400).json({ error: 'Envie a lista em items.' })
      return
    }

    const imported = await replaceCollaboratorsRecords(items)
    await emitCollaboratorsChanged()

    response.status(200).json({
      total: imported.length,
      message: 'Lista de colaboradores ativos importada.',
    })
  } catch (error) {
    const status = mapErrorStatus(error)

    if (status !== 500) {
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Erro interno no servidor.',
      })
      return
    }

    next(error)
  }
})

app.patch('/api/collaborators/:matricula', async (request, response, next) => {
  try {
    const originalMatricula = String(request.params.matricula ?? '').trim()
    const parsed = validateCollaborator(request.body)

    if ('error' in parsed) {
      response.status(400).json(parsed)
      return
    }

    const item = await updateCollaboratorRecord(originalMatricula, parsed)
    await emitCollaboratorsChanged()

    response.json({ item })
  } catch (error) {
    const status = mapErrorStatus(error)

    if (status !== 500) {
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Erro interno no servidor.',
      })
      return
    }

    next(error)
  }
})

app.delete('/api/collaborators/:matricula', async (request, response, next) => {
  try {
    const matricula = String(request.params.matricula ?? '').trim()
    await deleteCollaboratorRecord(matricula)
    await emitCollaboratorsChanged()
    response.status(204).end()
  } catch (error) {
    const status = mapErrorStatus(error)

    if (status !== 500) {
      response.status(status).json({
        error: error instanceof Error ? error.message : 'Erro interno no servidor.',
      })
      return
    }

    next(error)
  }
})

io.on('connection', async (socket) => {
  try {
    if (supabase) {
      await ensureSupabaseSeed()
    }

    const payload = await getCollaboratorsPayload()
    socket.emit('collaborators:changed', {
      total: payload.total,
      updatedAt: payload.updatedAt,
    })
  } catch (error) {
    console.error('Falha ao sincronizar socket:', error)
  }
})

app.use((error, _request, response, _next) => {
  console.error('Erro nao tratado na API:', error)
  response.status(500).json({
    error: 'Erro interno no servidor.',
  })
})

httpServer.listen(port, host, () => {
  console.log(`Servidor de colaboradores ativo em http://${host}:${port}`)
  console.log(`Armazenamento: ${usingSupabase ? 'supabase' : 'file'}`)
})

httpServer.on('error', (error) => {
  console.error('Falha ao iniciar servidor:', error)
  process.exit(1)
})
