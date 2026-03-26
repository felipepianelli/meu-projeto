import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const rootDir = process.cwd()
const workbookPath = path.join(rootDir, 'colaboradores.xlsx')
const outputPath = path.join(rootDir, 'src', 'data', 'collaborators.json')

const workbook = XLSX.readFile(workbookPath)
const worksheet = workbook.Sheets[workbook.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(worksheet, {
  header: 1,
  raw: false,
})

const collaborators = rows
  .slice(1)
  .map((row) => ({
    matricula: String(row[0] ?? '').trim(),
    nome: String(row[1] ?? '').trim(),
  }))
  .filter((row) => row.matricula && row.nome)

fs.writeFileSync(outputPath, `${JSON.stringify(collaborators, null, 2)}\n`, 'utf8')

console.log(`Arquivo atualizado com ${collaborators.length} colaboradores em ${outputPath}`)
