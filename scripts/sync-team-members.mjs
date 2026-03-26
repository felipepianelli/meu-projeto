import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const envPath = path.join(root, '.env.local')
const outputPath = path.join(root, 'public', 'team-members-cache.json')
const collaboratorsPath = path.join(root, 'src', 'data', 'collaborators.json')

const envRaw = await fs.readFile(envPath, 'utf8')
const tokenLine = envRaw
  .split(/\r?\n/)
  .find((line) => line.startsWith('VITE_SKORE_API_TOKEN='))

if (!tokenLine) {
  throw new Error('VITE_SKORE_API_TOKEN nao encontrado em .env.local')
}

const token = tokenLine.split('=')[1]?.trim()

if (!token) {
  throw new Error('Token vazio em .env.local')
}

const collaboratorsRaw = await fs.readFile(collaboratorsPath, 'utf8')
const collaborators = JSON.parse(collaboratorsRaw.replace(/^\uFEFF/, ''))

const teamsResponse = await fetch('https://user.skore.ai/v1/teams?skip=0&take=500', {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  },
})

if (!teamsResponse.ok) {
  throw new Error(`Falha ao buscar teams (${teamsResponse.status})`)
}

const teamsPayload = await teamsResponse.json()
const jslGruTeams = teamsPayload.items.filter((team) =>
  String(team.name || '')
    .toLowerCase()
    .includes('jsl/gru'),
)

const teamsById = new Map(
  jslGruTeams.map((team) => [
    team.id,
    {
      id: team.id,
      name: team.name,
      usersCount: team.usersCount,
      members: [],
    },
  ]),
)

const batchSize = 10

for (let index = 0; index < collaborators.length; index += batchSize) {
  const batch = collaborators.slice(index, index + batchSize)
  const settled = await Promise.allSettled(
    batch.map(async (item) => {
      const url = new URL('https://knowledge.skore.io/workspace/v2/users')
      url.searchParams.set('username__eq', String(item.matricula).trim())
      url.searchParams.set('find_exact_match', 'true')
      url.searchParams.set('limit', '2')
      url.searchParams.set('active', 'true')

      const response = await fetch(url, {
        headers: {
          Authorization: token,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error(`Falha ao buscar usuario ${item.matricula} (${response.status})`)
      }

      const payload = await response.json()
      return payload.results?.[0]
    }),
  )

  settled.forEach((result) => {
    if (result.status !== 'fulfilled' || !result.value) {
      return
    }

    const user = result.value

    for (const team of user.teams ?? []) {
      const target = teamsById.get(team.id)

      if (!target) {
        continue
      }

      target.members.push({
        id: user.id,
        name: user.name,
        username: user.username ?? null,
      })
    }
  })
}

const cache = {
  generatedAt: new Date().toISOString(),
  teams: Array.from(teamsById.values()).map((team) => ({
    ...team,
    members: team.members
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
      .filter(
        (member, memberIndex, arr) =>
          arr.findIndex((item) => item.id === member.id) === memberIndex,
      ),
  })),
}

for (const team of jslGruTeams) {
  const target = cache.teams.find((item) => item.id === team.id)

  if (!target || !Array.isArray(team.userIds) || !team.userIds.length) {
    continue
  }

  const missingIds = team.userIds.filter(
    (userId) => !target.members.some((member) => member.id === userId),
  )

  for (const userId of missingIds) {
    const response = await fetch(`https://knowledge.skore.io/workspace/v1/users/${userId}`, {
      headers: {
        Authorization: token,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      continue
    }

    const user = await response.json()
    target.members.push({
      id: user.id,
      name: user.name,
      username: user.username ?? null,
    })
  }

  target.members = target.members
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    .filter(
      (member, memberIndex, arr) =>
        arr.findIndex((item) => item.id === member.id) === memberIndex,
    )
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, JSON.stringify(cache, null, 2), 'utf8')

console.log(
  JSON.stringify(
    {
      generatedAt: cache.generatedAt,
      teams: cache.teams.length,
      totalMembers: cache.teams.reduce((sum, team) => sum + team.members.length, 0),
      outputPath,
    },
    null,
    2,
  ),
)
