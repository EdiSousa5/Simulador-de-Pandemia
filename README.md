# Simulador de Pandemia

Simulação interativa da propagação de uma epidemia sobre um mapa-mundo pontilhado,
construída com **Canvas 2D e JavaScript puro** — sem frameworks, sem dependências,
sem passo de build.

Projeto da unidade curricular de Computação Gráfica.

![Estado](https://img.shields.io/badge/stack-HTML%20%7C%20CSS%20%7C%20JS-38bdf8)

## Demonstração

> Substituir pelo URL do Vercel depois do deploy.

## O que faz

- **4.310 agentes** distribuídos pelas massas continentais, cada um com um de quatro estados:
  saudável, infetado, curado ou morto.
- **Contágio por proximidade** — um infetado tenta contaminar os vizinhos dentro de um raio,
  em intervalos regulares, com uma probabilidade configurável. O raio tem um pequeno ruído
  aleatório para a mancha não crescer como um círculo perfeito.
- **Desfecho probabilístico** — passado um tempo de incubação, cada infetado faz tentativas
  periódicas que resultam em morte, cura, ou nada (continua infetado).
- **Transmissão por via aérea** — aviões percorrem rotas entre aeroportos. Um aeroporto cuja
  vizinhança esteja infetada fica contaminado; um avião que parta dele transporta o vírus e
  semeia um novo foco no destino. É assim que o surto salta de continente.
- Aeroportos podem ser **adicionados e removidos** em tempo real, com as rotas dos aviões
  reindexadas automaticamente.

## Decisões técnicas

| Problema | Solução |
|---|---|
| Verificar vizinhos de 4.310 agentes seria `O(n²)` por tick | *Spatial hash grid* calculado uma única vez no arranque (as pessoas não se movem), produzindo listas de adjacência em `Int32Array` |
| Simulação dependente da taxa de fotogramas | Passo fixo de 50 ms com acumulador no `requestAnimationFrame`, com limite de ticks por fotograma para evitar a *spiral of death* após o separador ficar em segundo plano |
| 4.310 chamadas `arc()` + `fill()` por fotograma | Desenho em lote: um único `Path2D` implícito por estado, quatro `fill()` por fotograma |
| Canvas desfocado em ecrãs HiDPI | O canvas é dimensionado por `devicePixelRatio` e o contexto recebe uma transformação de escala, mantendo um espaço lógico fixo de 1024×580 |
| Multiplicador de velocidade | Escala o tempo simulado por fotograma, não o número de `setInterval` — a simulação continua determinística no passo |

## Controlos

| Ação | Como |
|---|---|
| Iniciar o surto | Clicar num ponto do mapa |
| Pausar / retomar | `Espaço` ou os botões da barra superior |
| Abrir o painel | `M` ou o botão *Controlos* |
| Cancelar modo / fechar painel | `Esc` |

## Estrutura

```
index.html              markup e sprite SVG de ícones
src/style.css           tema, layout responsivo
src/app.js              motor da simulação e renderizador
src/world-points.js     coordenadas geradas dos pontos de terra
assets/                 sprites dos aviões
tools/image-to-points.html   gerador offline de world-points.js a partir de uma imagem
vercel.json             cabeçalhos de cache para o deploy estático
```

## Executar localmente

Qualquer servidor estático serve. Por exemplo:

```bash
npx serve .
# ou
python -m http.server 8000
```

Abrir `http://localhost:8000`. (Abrir o `index.html` diretamente pelo ficheiro também
funciona, por serem scripts clássicos e não módulos ES.)

## Deploy no Vercel

O projeto é 100% estático e não precisa de configuração de build:

1. `vercel` na raiz do repositório, ou importar o repositório em vercel.com.
2. *Framework preset*: **Other**. *Build command*: vazio. *Output directory*: `.`

## Créditos e licença

Os sprites dos aviões (`assets/`) são arte pixel própria do projeto.
As coordenadas em `src/world-points.js` são uma amostragem em grelha de contornos
continentais. Se quiser regenerá-las, use um mapa de **domínio público**
(por exemplo, [Natural Earth](https://www.naturalearthdata.com/)) com a ferramenta em
`tools/image-to-points.html` — nunca uma imagem de banco de imagens com marca de água.

Código disponibilizado sob licença MIT.
