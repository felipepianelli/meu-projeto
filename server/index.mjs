import cors from 'cors'
import express from 'express'
import { createServer } from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Server as SocketServer } from 'socket.io'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const dbPath =
  process.env.COLLABORATORS_DB_PATH ||
  path.join(__dirname, 'data', 'collaborators-db.json')
const dbDir = path.dirname(dbPath)
const collaboratorsSeedPath = path.join(rootDir, 'src', 'data', 'collaborators.json')
const parsedPort = Number(process.env.PORT)
const port = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 3030
const host = process.env.HOST || '0.0.0.0'

fs.mkdirSync(dbDir, { recursive: true })

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

function listCollaborators() {
  return readDatabase().items
    .slice()
    .sort((a, b) => {
      const nameDiff = a.nome.localeCompare(b.nome, 'pt-BR')

      if (nameDiff !== 0) {
        return nameDiff
      }

      return a.matricula.localeCompare(b.matricula, 'pt-BR')
    })
}

function getCollaboratorsPayload() {
  const database = readDatabase()
  const items = listCollaborators().map((item) => ({
    matricula: item.matricula,
    nome: item.nome,
  }))

  return {
    items,
    total: items.length,
    updatedAt: database.updatedAt,
  }
}

function emitCollaboratorsChanged() {
  io.emit('collaborators:changed', {
    total: getCollaboratorsPayload().total,
    updatedAt: new Date().toISOString(),
  })
}

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

function ensureDatabase() {
  if (fs.existsSync(dbPath)) {
    return
  }

  const seedRows = JSON.parse(fs.readFileSync(collaboratorsSeedPath, 'utf8'))
  const timestamp = new Date().toISOString()

  writeDatabase({
    updatedAt: timestamp,
    items: seedRows.map((row) => ({
      matricula: String(row.matricula ?? '').trim(),
      nome: String(row.nome ?? '').trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
  })
}

function readDatabase() {
  ensureDatabase()
  return JSON.parse(fs.readFileSync(dbPath, 'utf8'))
}

function writeDatabase(database) {
  fs.writeFileSync(dbPath, JSON.stringify(database, null, 2), 'utf8')
}

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'skore-manager-collaborators',
    environment: process.env.NODE_ENV || 'development',
    port,
    totalCollaborators: getCollaboratorsPayload().total,
  })
})

app.get('/', (_request, response) => {
  response.json({
    ok: true,
    service: 'skore-manager-collaborators',
    message: 'API online',
  })
})

app.get('/api/collaborators', (_request, response) => {
  response.json(getCollaboratorsPayload())
})

app.post('/api/collaborators', (request, response) => {
  const parsed = validateCollaborator(request.body)

  if ('error' in parsed) {
    response.status(400).json(parsed)
    return
  }

  const database = readDatabase()
  const existing = database.items.find((item) => item.matricula === parsed.matricula)

  if (existing) {
    response.status(409).json({
      error: 'Ja existe um colaborador com essa matricula.',
    })
    return
  }

  const timestamp = new Date().toISOString()
  database.items.push({
    matricula: parsed.matricula,
    nome: parsed.nome,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  database.updatedAt = timestamp
  writeDatabase(database)

  emitCollaboratorsChanged()
  response.status(201).json({
    item: {
      matricula: parsed.matricula,
      nome: parsed.nome,
    },
  })
})

app.patch('/api/collaborators/:matricula', (request, response) => {
  const originalMatricula = String(request.params.matricula ?? '').trim()
  const parsed = validateCollaborator(request.body)

  if ('error' in parsed) {
    response.status(400).json(parsed)
    return
  }

  const database = readDatabase()
  const existing = database.items.find((item) => item.matricula === originalMatricula)

  if (!existing) {
    response.status(404).json({
      error: 'Colaborador nao encontrado.',
    })
    return
  }

  const duplicate = database.items.find(
    (item) =>
      item.matricula === parsed.matricula && item.matricula !== originalMatricula,
  )

  if (duplicate) {
    response.status(409).json({
      error: 'Ja existe um colaborador com essa matricula.',
    })
    return
  }

  const timestamp = new Date().toISOString()
  database.items = database.items.map((item) =>
    item.matricula === originalMatricula
      ? {
          ...item,
          matricula: parsed.matricula,
          nome: parsed.nome,
          updatedAt: timestamp,
        }
      : item,
  )
  database.updatedAt = timestamp
  writeDatabase(database)

  emitCollaboratorsChanged()
  response.json({
    item: {
      matricula: parsed.matricula,
      nome: parsed.nome,
    },
  })
})

app.delete('/api/collaborators/:matricula', (request, response) => {
  const matricula = String(request.params.matricula ?? '').trim()
  const database = readDatabase()
  const nextItems = database.items.filter((item) => item.matricula !== matricula)

  if (nextItems.length === database.items.length) {
    response.status(404).json({
      error: 'Colaborador nao encontrado.',
    })
    return
  }

  database.items = nextItems
  database.updatedAt = new Date().toISOString()
  writeDatabase(database)
  emitCollaboratorsChanged()
  response.status(204).end()
})

io.on('connection', (socket) => {
  socket.emit('collaborators:changed', {
    total: getCollaboratorsPayload().total,
    updatedAt: new Date().toISOString(),
  })
})

app.use((error, _request, response, _next) => {
  console.error('Erro nao tratado na API:', error)
  response.status(500).json({
    error: 'Erro interno no servidor.',
  })
})

httpServer.listen(port, host, () => {
  console.log(`Servidor de colaboradores ativo em http://${host}:${port}`)
})

httpServer.on('error', (error) => {
  console.error('Falha ao iniciar servidor:', error)
  process.exit(1)
})
