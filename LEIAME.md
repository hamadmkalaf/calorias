# Calorias

Diário simples de calorias e macros. Web app instalável (PWA) para Android, sem etapa de build: são apenas arquivos estáticos.

## O que faz

- **Diário** por dia e refeição, com metas de calorias, proteína, carboidrato, gordura e fibra.
- **Meus alimentos**: repositório próprio, ordenado pelos mais usados.
- **Código de barras**: lê com a câmera e busca o produto no Open Food Facts. Se não achar, você digita os valores do rótulo uma vez e o produto fica salvo.
- **Busca online** por nome (Open Food Facts, produtos da Irlanda primeiro).
- **Funciona offline**; os dados ficam no aparelho e sincronizam com o Supabase quando há login.
- **Backup** em arquivo (Ajustes > Exportar / Importar).

## Colocar no ar

A câmera e a instalação no celular exigem HTTPS, então o app precisa estar hospedado.

### 1. Supabase (sincronização)

1. Crie um projeto gratuito em supabase.com.
2. Em **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Project Settings > API**, copie a **Project URL** e a chave **anon / publishable**.
4. Cole as duas em `config.js` (ou digite-as depois na tela Ajustes do app).
5. Opcional: em **Authentication > Sign In / Providers > Email**, desative "Confirm email" para entrar logo após criar a conta.

### 2. Hospedagem

Qualquer hospedagem de arquivos estáticos serve (Netlify, Cloudflare Pages, GitHub Pages). Publique a pasta inteira.

### 3. No celular

Abra o endereço no Chrome do Android, toque em **⋮ > Adicionar à tela inicial**, depois vá em **Ajustes > Sincronização**, crie a conta e entre.

## Testar no computador

```bash
python -m http.server 5173
```

Depois abra http://localhost:5173.

## Próxima etapa

Análise por foto (prato e rótulo) com IA.
