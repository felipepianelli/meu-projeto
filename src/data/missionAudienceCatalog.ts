export type MissionAudienceSource = {
  id: string
  name: string
  type: 'team' | 'user'
}

export type MissionAudienceDefinition = {
  id: string
  name: string
  active: boolean
  createdAt: number
  audience: MissionAudienceSource[]
}

export const missionAudienceCatalog: MissionAudienceDefinition[] = [
  {
    id: '69bbfff3c5fd730b831f3fe1',
    name: 'PRO-GRU0006 - TREINAMENTOS',
    active: true,
    createdAt: 1773928435114,
    audience: [
      {
        id: '640484',
        name: 'JSL/GRU - Gestores Treinamento',
        type: 'team',
      },
    ],
  },
  {
    id: '69bbfc007d182397c2c5ec9c',
    name: 'PRO-GRU0003 - NAO CONFORMIDADE E ACAO CORRETIVA',
    active: true,
    createdAt: 1773927424514,
    audience: [
      {
        id: '640485',
        name: 'JSL/GRU - Gestores',
        type: 'team',
      },
    ],
  },
  {
    id: '69bbfa20acc1fcc4b935aecd',
    name: 'PRO-GRU0002 - INFORMACAO DOCUMENTADA E ELABORACAO DE DOCUMENTO',
    active: true,
    createdAt: 1773926944171,
    audience: [
      {
        id: '640484',
        name: 'JSL/GRU - Gestores Treinamento',
        type: 'team',
      },
    ],
  },
  {
    id: '69bbf8bfc5fd730b831f296d',
    name: 'PRO-GRU0010 - CONTROLE DE MUDANCA',
    active: true,
    createdAt: 1773926591041,
    audience: [
      {
        id: '640485',
        name: 'JSL/GRU - Gestores',
        type: 'team',
      },
    ],
  },
  {
    id: '69bbf7edef2c7d4c4596bfb5',
    name: 'PRO-GRU0005 - AUDITORIA INTERNA E AUTO INSPECAO',
    active: true,
    createdAt: 1773926381421,
    audience: [
      {
        id: '640485',
        name: 'JSL/GRU - Gestores',
        type: 'team',
      },
    ],
  },
  {
    id: '69b8019b5ca1edf09fe6f26a',
    name: 'Mapeamento de Processos - JSL',
    active: true,
    createdAt: 1773666715060,
    audience: [
      {
        id: '640352',
        name: 'JSL/GRU - Mapeamento',
        type: 'team',
      },
    ],
  },
  {
    id: '1eBwSAuZOWVtw1tjoRnz',
    name: 'M0154 - Manual da Qualidade - BPA E Distribuicao de Cargas - GRU',
    active: true,
    createdAt: 1769438643210,
    audience: [
      {
        id: '631727',
        name: 'JSL/GRU - GESTORES ELEGIVEIS - TRILHA DA QUALIDADE GRU',
        type: 'team',
      },
      {
        id: '639071',
        name: 'JSL/GRU - MANUAL DA QUALIDADE - BOAS PRATICAS DE ARMAZENAGEM E DISTRIBUICAO DE CARGAS',
        type: 'team',
      },
    ],
  },
  {
    id: 'uKl3g0wnDJt2yUVy9UTZ',
    name: 'PRO9206 - Boas Praticas de Documentacao - GRU',
    active: true,
    createdAt: 1758017293077,
    audience: [],
  },
  {
    id: 'Frb0qCla5AFFUu4jSb35',
    name: 'PRO9214 - GERENCIAMENTO DE RESIDUOS - GRU',
    active: true,
    createdAt: 1761650641070,
    audience: [],
  },
  {
    id: 'fYvcypJb7i3mw6wu6gzK',
    name: 'IST1489 - MOVIMENTACAO DE CARGAS POR EMPILHADEIRA/TRANSPALETEIRA - GRU',
    active: true,
    createdAt: 1756988591627,
    audience: [],
  },
  {
    id: 'rSX2ue12iv2nkVWLiaf0',
    name: 'PRO9210 - EXPORTACAO - GRU',
    active: true,
    createdAt: 1758132296058,
    audience: [],
  },
  {
    id: '1cSkSReuAJxCotDkdHds',
    name: 'PRO9199 - ENTREGA, CONTROLE E UTILIZACAO DE EPI - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'nbFRaEzomR8jtSXH5Yiu',
    name: 'PRO9201 - CLASSIFICACAO E IDENTIFICACAO DE ACIDENTES E INCIDENTES - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'meC4x77VGY8BRnUKVfVA',
    name: 'PRO9215 - PLANO DE ATENDIMENTO DE EMERGENCIA - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'HhctMoSdWkm5EBYxobjj',
    name: 'IST1487 - PONTO ZERO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'iaPnHTpgZ4UzTujxZJLs',
    name: 'PRO9162 - RECEBIMENTO DE IMPORTACAO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'aQUdbb3ZIDwMmS3BAgxj',
    name: 'PRO9164 - Courier',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'vnDsPtfjsR0sM0tYsq8n',
    name: 'PRO9207 - ESTACIONAMENTO E GESTAO DE DOCAS - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '2SJ4wKfm1gcxpGs65MDS',
    name: 'IST1490 - Linha Saude - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'XnX8OLr8ajspN4JoThGd',
    name: 'IST1484 - Gestao de Racks - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '0kLtusLnXG7hBsmXwfca',
    name: 'PRO9260 - MANUTENCAO CORRETIVA E PREVENTIVA DE EQUIPAMENTOS DE MOVIMENTACAO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'j7Yg2O5wmZTrqnD8eBgp',
    name: 'IST1585 - DESPALETIZACAO DE VOOS - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '34QkLgOzWYfifhSVMtar',
    name: 'PRO9220 - QUALIFICACAO DE FORNECEDORES - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '2eWNbMBVb2G0iNx97LjF',
    name: 'PRO9188 - LIMPEZA NAS INSTALACOES - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '0TRjzecjrar5yRJvdNjj',
    name: 'PRO9157 - INVENTARIO',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'bwHE8ibsClne7yg7lSdV',
    name: 'PRO9202 - CONTROLE DE CARGAS PERIGOSAS - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'd9mB8WQBZQxxawP30yvg',
    name: 'PRO9200 - INSPECAO DE EQUIPAMENTOS DE MOVIMENTACAO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'laR0mzhYEtLts8rghqTc',
    name: 'PRO9256 - Manutencao Predial',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'CycHEEdGGXYJSByrCtEo',
    name: 'IST1488 - RECUSA DO TRANSELEVADOR - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'vuNg3gi0f6FWNQfYISAS',
    name: 'PRO9209 - EXPEDICAO DE IMPORTACAO',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'NzQS7SfIxDDEP0uBFx5v',
    name: 'IST1502 - Inspecao e Servicos - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'waFB96Bm22dhMLLlKdTO',
    name: 'IST1553 - Gestao de Docas',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'kFEkFZQXIBJuH3zR5ThU',
    name: 'IST1558 - Amarracao de ULD - Lamina Palete Aereo - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: '7M1bIbGVCNTCKlqeWNUp',
    name: 'IST1554 - Estacionamentos',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'PriGddveefbLyeIx3Zua',
    name: 'IST1556 - MOVIMENTACAO DE CARGAS PERIGOSAS - IMPORTACAO E EXPORTACAO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 'Tk0QOcAI2tGZdKSnpI6D',
    name: 'PRO9156 - ARMAZENAGEM NA IMPORTACAO - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
  {
    id: 's0gmdF7AeW7ItSrJhEIT',
    name: 'IST1503 - MOVIMENTACAO MANUAL DE CARGAS - GRU',
    active: true,
    createdAt: 0,
    audience: [],
  },
]
