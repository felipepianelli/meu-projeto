# Deploy no Render

## Arquitetura recomendada

- Frontend web: Render Static Site
- API central de colaboradores: Render Web Service ja publicado
- Base persistente dos colaboradores: banco oficial no backend online

## Arquivos já preparados

- [render.yaml](C:\Users\Felipe Pianelli\Desktop\projeto novo\render.yaml)
- [server/index.mjs](C:\Users\Felipe Pianelli\Desktop\projeto novo\server\index.mjs)
- [vite.config.ts](C:\Users\Felipe Pianelli\Desktop\projeto novo\vite.config.ts)

## O que subir

1. Envie este projeto para um repositório GitHub.
2. No Render, escolha **New + > Blueprint**.
3. Conecte o repositório.
4. O Render deve ler o `render.yaml` e criar:
   - `skore-manager-web`

## Variáveis importantes

O frontend web ja esta apontando para a URL publica da API:

- `VITE_COLLABORATORS_API_URL=https://meu-backend-2p74.onrender.com`

## Observação importante

O frontend passa a usar o backend online como fonte oficial dos colaboradores. A planilha local fica apenas como seed historico do projeto, nao como fonte principal da aplicacao web.

## Depois do deploy

1. Abra a URL do serviço `skore-manager-web`
2. Faça login
3. Teste criar, editar e excluir um colaborador
4. Abra em outro navegador e confirme a atualização em tempo real
