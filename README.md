# Site de resultados — OCR de placas na Jetson Nano

Site estático com **todas** as métricas do TCC (fusão e compressão de modelos de reconhecimento de placas em baixa resolução na NVIDIA Jetson Nano). O pôster mostra os destaques; o QR code dele aponta pra cá.

Sem servidor e sem dependências: HTML + CSS + JavaScript puro, gráficos em SVG. Abre até com duplo clique no `index.html`.

## Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Página (seções: resumo, acurácia × vazão, compressão, fusão, PARSeq, pruning, temperatura, desktop × Jetson, tabela completa, método) |
| `styles.css` | Estilo, temas claro/escuro |
| `app.js` | Gráficos e tabelas, lidos de `data/data.js` |
| `build_data.py` | Gera `data/` a partir dos CSVs do projeto (`../ml/ml/logs/jetson*/`) |
| `data/data.js` | Dados do site (gerado — não editar à mão) |
| `data/execucoes.csv` | Tabela completa para download (gerada) |
| `artigo.pdf` | **Colocar aqui** o PDF do artigo (o botão "Artigo (PDF)" aponta para ele) |

## Atualizar os dados

Sempre que os resultados mudarem no projeto:

```bash
python build_data.py                    # lê ../ml/ml
python build_data.py --ml-dir CAMINHO   # se o projeto estiver em outro lugar
```

O script recalcula também as fusões por veículo (HC, MV, MVCP) e todos os ensembles a partir das predições — os números batem com o artigo.

## Testar localmente

Duplo clique no `index.html`, ou com um servidor local:

```bash
python -m http.server 8000
# abrir http://localhost:8000
```

## Publicar

**GitHub Pages:** criar um repositório (ex.: `tcc-placa-ocr-resultados`), subir esta pasta e, em *Settings → Pages*, escolher *Deploy from a branch* → `main` / `/ (root)`. O link fica `https://<usuario>.github.io/tcc-placa-ocr-resultados/`.

**Cloudflare Pages:** conectar o mesmo repositório (sem comando de build; diretório de saída `/`), ou enviar direto da pasta:

```bash
npx wrangler pages deploy . --project-name tcc-placa-ocr-resultados
```
