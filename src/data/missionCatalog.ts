export type MissionCatalogItem = {
  code: string
  name: string
}

export const missionCatalog: MissionCatalogItem[] = [
  { code: 'IST1484', name: 'Gestao de Racks - GRU' },
  { code: 'IST1487', name: 'Ponto Zero - GRU' },
  { code: 'IST1488', name: 'Recusa do Transelevador - GRU' },
  { code: 'IST1489', name: 'Movimentacao de Cargas por Empilhadeira/Transpaleteira - GRU' },
  { code: 'IST1490', name: 'Linha Saude - GRU' },
  { code: 'IST1502', name: 'Inspecao e Servicos - GRU' },
  { code: 'IST1503', name: 'Movimentacao Manual de Cargas - GRU' },
  { code: 'IST1553', name: 'Gestao de Docas' },
  { code: 'IST1554', name: 'Estacionamento' },
  { code: 'IST1556', name: 'Movimentacao de Cargas Perigosas - Importacao e Exportacao - GRU' },
  { code: 'IST1558', name: 'Amarracao de ULD - Lamina Palete Aereo - GRU' },
  { code: 'IST1585', name: 'Despaletizacao de Voos - GRU' },
  { code: 'M0154', name: 'Manual da Qualidade - BPA e Distribuicao de Cargas - GRU' },
  { code: 'PR09156', name: 'Armazenagem na Importacao - GRU' },
  { code: 'PR09157', name: 'Inventario' },
  { code: 'PR09162', name: 'Recebimento de Importacao - GRU' },
  { code: 'PR09164', name: 'Courier' },
  { code: 'PR09188', name: 'Limpeza nas Instalacoes - GRU' },
  { code: 'PR09199', name: 'Entrega, Controle e Utilizacao de EPI - GRU' },
  { code: 'PR09200', name: 'Inspecao de Equipamentos de Movimentacao - GRU' },
  { code: 'PR09201', name: 'Classificacao e Identificacao de Acidentes e Incidentes - GRU' },
  { code: 'PR09202', name: 'Controle de Cargas Perigosas - GRU' },
  { code: 'PR09206', name: 'Boas Praticas de Documentacao - GRU' },
  { code: 'PR09207', name: 'Estacionamento e Gestao de Docas - GRU' },
  { code: 'PR09209', name: 'Expedicao de Importacao' },
  { code: 'PR09210', name: 'Exportacao - GRU' },
  { code: 'PR09214', name: 'Gerenciamento de Residuos - GRU' },
  { code: 'PR09215', name: 'Plano de Atendimento de Emergencia - GRU' },
  { code: 'PR09220', name: 'Qualificacao de Fornecedores - GRU' },
  { code: 'PR09256', name: 'Manutencao Predial' },
  { code: 'PR09260', name: 'Manutencao Corretiva e Preventiva de Equipamentos de Movimentacao - GRU' },
  { code: 'PRO-GRU0002', name: 'Informacao Documentada e Elaboracao de Documento' },
  { code: 'PRO-GRU0003', name: 'Nao Conformidade e Acao Corretiva' },
  { code: 'PRO-GRU0005', name: 'Auditoria Interna e Auto Inspecao' },
  { code: 'PRO-GRU0006', name: 'Treinamentos' },
  { code: 'PRO-GRU0010', name: 'Controle de Mudanca' },
]

export function getMissionLabelFromTeamName(teamName: string) {
  const normalizedTeam = normalizeLabel(teamName)
    .replace('jsl gru', '')
    .replace('jsl/gru', '')
    .replace(' - gestores treinamento', '')
    .replace(' - gestores', '')
    .replace(' - mapeamento', '')
    .trim()

  const directMatch = missionCatalog.find((item) =>
    normalizedTeam.includes(normalizeLabel(item.name)),
  )

  if (directMatch) {
    return `${directMatch.code} - ${directMatch.name}`
  }

  const looseMatch = missionCatalog.find((item) => {
    const normalizedMission = normalizeLabel(item.name)
      .replace(' - gru', '')
      .replace('importacao e exportacao', 'impo e expo')
      .trim()

    return (
      normalizedMission.includes(normalizedTeam) ||
      normalizedTeam.includes(normalizedMission)
    )
  })

  if (looseMatch) {
    return `${looseMatch.code} - ${looseMatch.name}`
  }

  return teamName
}

function normalizeLabel(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}
