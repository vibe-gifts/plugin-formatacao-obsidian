const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice } = require("obsidian");

const PADRAO = { botaoAoColar: true, barraAoSelecionar: true };

const ABERTURA_CERCA = /^\s*(```+|~~~+)/;

function recuoMinimo(linhas) {
  let min = Infinity;
  for (const l of linhas) {
    if (!l.trim()) continue;
    min = Math.min(min, l.match(/^[ \t]*/)[0].length);
  }
  return min === Infinity ? 0 : min;
}

function separarBlocos(linhas) {
  const blocos = [];
  let atual = { codigo: false, linhas: [] };
  let cerca = null;
  for (const l of linhas) {
    const m = l.match(ABERTURA_CERCA);
    if (!cerca && m) {
      if (atual.linhas.length) blocos.push(atual);
      atual = { codigo: true, linhas: [l] };
      cerca = m[1][0];
    } else if (cerca && m && m[1][0] === cerca) {
      atual.linhas.push(l);
      blocos.push(atual);
      atual = { codigo: false, linhas: [] };
      cerca = null;
    } else {
      atual.linhas.push(l);
    }
  }
  if (atual.linhas.length) blocos.push(atual);
  return blocos;
}

function limparCodigo(linhas) {
  const abre = linhas[0].trim();
  const fechado = linhas.length > 1 && ABERTURA_CERCA.test(linhas[linhas.length - 1]);
  const fecha = fechado ? linhas[linhas.length - 1].trim() : null;
  let miolo = linhas.slice(1, fechado ? -1 : undefined).map((l) => l.replace(/[ \t]+$/, ""));
  const recuo = recuoMinimo(miolo);
  miolo = miolo.map((l) => l.slice(Math.min(recuo, l.length)));
  const saida = [];
  for (const l of miolo) {
    if (!l && (!saida.length || !saida[saida.length - 1])) continue;
    saida.push(l);
  }
  while (saida.length && !saida[saida.length - 1]) saida.pop();
  return [abre, ...saida, ...(fecha ? [fecha] : [])];
}

function pareceCaixaAlta(l) {
  const s = l.trim();
  if (s.length < 3 || s.length > 90 || /^[-*>|#`]/.test(s) || /https?:\/\//.test(s) || /[.!?,;]$/.test(s)) {
    return false;
  }
  const base = s.replace(/^\d+[.)]\s+/, "").replace(/\([^)]*\)|\[[^\]]*\]/g, "");
  const letras = base.replace(/[^\p{L}]/gu, "");
  return letras.length >= 3 && letras === letras.toUpperCase() && letras !== letras.toLowerCase();
}

function marcarTitulo(l) {
  const negrito = l.match(/^\*\*([^*\n]{1,80}?)\*\*:?$/);
  if (negrito) return "## " + negrito[1].trim();
  if (pareceCaixaAlta(l)) return "## " + l.trim().replace(/:$/, "");
  return l;
}

function tirarTravessoes(l) {
  l = l.replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2");
  let n = 0;
  return l.replace(/\s*[—–―]+\s*|\s+--\s+/g, (m, pos, todo) => {
    const antes = todo.slice(0, pos).trim();
    if (!antes || pos + m.length >= todo.length) return "";
    if (/[.,;:!?]$/.test(antes)) return " ";
    const primeiro = n++ === 0;
    const rotulo =
      primeiro &&
      (/^#/.test(todo) || pareceCaixaAlta(todo) || (antes.split(/\s+/).length <= 4 && todo.length <= 80));
    return rotulo ? ": " : ", ";
  });
}

function limparLinha(l) {
  l = l.replace(/[ \t]+$/, "");
  if (!l.trim()) return "";
  if (/^\s*[─━═▬\-_=*~·•]{4,}\s*$/.test(l) || /^\s*\*+\s*$/.test(l)) return "";
  l = l.replace(/^(\s*)[•◦▪●‣∙·]\s+/, "$1- ");
  l = l.replace(/^(\s*)[-*+]\s+(\d+[.)])\s+/, "$1$2 ");
  l = l.replace(/^(\s*)(\d+)\)\s+/, "$1$2. ");
  l = l.replace(/^(#{1,6})([^\s#])/, "$1 $2");
  l = l.replace(/\*\*[ \t]+([^*\n]+?)[ \t]+\*\*/g, "**$1**");
  l = l.replace(/\*\*[ \t]+([^*\n]+?)\*\*/g, "**$1**");
  l = l.replace(/\*\*([^*\n]+?)[ \t]+\*\*/g, "**$1**");
  l = tirarTravessoes(l);
  const lead = l.match(/^[ \t]*/)[0];
  return lead + l.slice(lead.length).replace(/(\S)[ \t]{2,}(?=\S)/g, "$1 ");
}

function celulas(l) {
  const s = l.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}

const ehSeparador = (cs) => cs.every((c) => /^:?-+:?$/.test(c));

function cercaDeTexto(linhas) {
  const saida = [];
  for (const bruta of linhas) {
    const l = limparLinha(bruta);
    if (!l.trim()) continue;
    if (saida.length && pareceCaixaAlta(l)) saida.push("");
    saida.push(l);
  }
  return ["```text", ...saida, "```"].map((linha) => ({ linha, codigo: true }));
}

function processarTabela(linhas) {
  const todas = linhas.map(celulas);
  const dados = todas.filter((cs) => !ehSeparador(cs));
  const colunas = Math.max(...todas.map((c) => c.length));
  if (colunas === 1) {
    const junto = dados.map((cs) => cs[0]).filter(Boolean).join("<br>");
    const partes = junto.split(/<br\s*\/?>/i).map((x) => x.replace(/\\\|/g, "|"));
    if (junto.length > 400 || (junto.match(/<br/gi) || []).length >= 5) return cercaDeTexto(partes);
    return partes
      .map((x) => limparLinha(x.trim()))
      .filter(Boolean)
      .map((x) => ({ linha: "> " + x, codigo: false }));
  }
  return todas.map((cs) => ({
    linha: ehSeparador(cs)
      ? "| " + cs.map(() => "---").join(" | ") + " |"
      : "| " + cs.map((c) => c.replace(/[ \t]{2,}/g, " ")).join(" | ") + " |",
    codigo: false,
    tabela: true,
  }));
}

function processarTexto(linhas) {
  const itens = [];
  for (let i = 0; i < linhas.length; ) {
    if (/^\s*\|/.test(linhas[i])) {
      let j = i;
      while (j < linhas.length && /^\s*\|/.test(linhas[j])) j++;
      itens.push(...processarTabela(linhas.slice(i, j)));
      i = j;
      continue;
    }
    const l = limparLinha(linhas[i]);
    itens.push({ linha: l ? marcarTitulo(l) : "", codigo: false });
    i++;
  }
  return itens;
}

function separarFrontmatter(t) {
  const m = t.match(/^---\n[\s\S]*?\n---[ \t]*(\n|$)/);
  if (!m) return { frontmatter: "", corpo: t };
  return { frontmatter: m[0].replace(/\n$/, ""), corpo: t.slice(m[0].length) };
}

function limparTexto(entrada) {
  const normal = entrada
    .replace(/\r\n?/g, "\n")
    .replace(/[​‌‍⁠﻿]/g, "")
    .replace(/[   ]/g, " ")
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'");
  const { frontmatter, corpo } = separarFrontmatter(normal);

  const itens = [];
  for (const b of separarBlocos(corpo.split("\n"))) {
    if (b.codigo) limparCodigo(b.linhas).forEach((linha) => itens.push({ linha, codigo: true }));
    else itens.push(...processarTexto(b.linhas));
  }

  const final = [];
  let anterior = null;
  for (const it of itens) {
    if (it.codigo) {
      final.push(it.linha);
      anterior = "codigo";
      continue;
    }
    if (!it.linha.trim()) continue;
    const titulo = /^#{1,6} /.test(it.linha);
    const abreTabela = it.tabela && anterior !== "tabela";
    const fechaTabela = !it.tabela && anterior === "tabela";
    if (final.length && (titulo || abreTabela || fechaTabela)) final.push("");
    final.push(it.linha);
    anterior = it.tabela ? "tabela" : "texto";
  }
  const texto = final.join("\n");
  return frontmatter ? frontmatter + (texto ? "\n" + texto : "") : texto;
}

function alternarEnvolver(editor, a, b) {
  const sel = editor.getSelection();
  const [, inicio, meio, fim] = sel.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!meio) return;
  const jaTem =
    meio.length >= a.length + b.length &&
    meio.startsWith(a) &&
    meio.endsWith(b) &&
    !(a === "*" && meio.startsWith("**"));
  const novo = jaTem ? meio.slice(a.length, meio.length - b.length) : a + meio + b;
  editor.replaceSelection(inicio + novo + fim);
  const fimOffset = editor.posToOffset(editor.getCursor());
  const ini = fimOffset - fim.length - novo.length;
  editor.setSelection(editor.offsetToPos(ini), editor.offsetToPos(ini + novo.length));
}

function definirTitulo(editor, nivel) {
  const de = editor.getCursor("from").line;
  const ate = editor.getCursor("to").line;
  for (let n = de; n <= ate; n++) {
    const linha = editor.getLine(n);
    const atual = linha.match(/^(#{1,6})\s+/);
    const base = linha.replace(/^#{1,6}\s+/, "");
    editor.setLine(n, atual && atual[1].length === nivel ? base : "#".repeat(nivel) + " " + base);
  }
}

function alternarPrefixo(editor, prefixo) {
  const de = editor.getCursor("from").line;
  const ate = editor.getCursor("to").line;
  for (let n = de; n <= ate; n++) {
    const linha = editor.getLine(n);
    editor.setLine(n, linha.startsWith(prefixo) ? linha.slice(prefixo.length) : prefixo + linha);
  }
}

function inserirLink(editor) {
  const sel = editor.getSelection();
  editor.replaceSelection(`[${sel}]()`);
  const pos = editor.offsetToPos(editor.posToOffset(editor.getCursor()) - 1);
  editor.setCursor(pos);
}

function removerMarcas(editor) {
  const sel = editor.getSelection();
  const limpo = sel
    .replace(/<\/?u>/g, "")
    .replace(/(\*\*|__|~~|==)(.+?)\1/gs, "$2")
    .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/gs, "$2")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^(#{1,6}\s+|>\s?|[-*+]\s+)/gm, "");
  editor.replaceSelection(limpo);
}

const BOTOES = [
  { r: "B", t: "Negrito", f: (e) => alternarEnvolver(e, "**", "**"), estilo: "font-weight:700" },
  { r: "I", t: "Itálico", f: (e) => alternarEnvolver(e, "*", "*"), estilo: "font-style:italic" },
  { r: "U", t: "Sublinhado", f: (e) => alternarEnvolver(e, "<u>", "</u>"), estilo: "text-decoration:underline" },
  { r: "S", t: "Riscado", f: (e) => alternarEnvolver(e, "~~", "~~"), estilo: "text-decoration:line-through" },
  { r: "==", t: "Realce", f: (e) => alternarEnvolver(e, "==", "==") },
  { r: "</>", t: "Código", f: (e) => alternarEnvolver(e, "`", "`") },
  null,
  { r: "H1", t: "Título 1", f: (e) => definirTitulo(e, 1) },
  { r: "H2", t: "Título 2", f: (e) => definirTitulo(e, 2) },
  { r: "H3", t: "Título 3", f: (e) => definirTitulo(e, 3) },
  null,
  { r: "•", t: "Lista", f: (e) => alternarPrefixo(e, "- ") },
  { r: "❝", t: "Citação", f: (e) => alternarPrefixo(e, "> ") },
  { r: "🔗", t: "Link", f: inserirLink },
  null,
  { r: "Tx", t: "Tirar formatação", f: removerMarcas },
  { r: "✨ Formatar", t: "Arrumar o texto selecionado", f: "formatar" },
];

module.exports = class FormatadorDeTexto extends Plugin {
  async onload() {
    this.settings = Object.assign({}, PADRAO, await this.loadData());
    this.barra = null;
    this.botaoColar = null;
    this.temporizador = null;

    this.addSettingTab(new AbaConfiguracoes(this.app, this));

    this.addCommand({
      id: "formatar-selecao-ou-nota",
      name: "Formatar seleção (ou a nota inteira)",
      editorCallback: (editor) => this.formatarSelecao(editor),
    });

    this.registerEvent(
      this.app.workspace.on("editor-paste", (_evt, editor) => {
        if (!this.settings.botaoAoColar) return;
        const antes = editor.getValue().length;
        const sobrescrito = editor.getSelection().length;
        const inicio = editor.posToOffset(editor.getCursor("from"));
        setTimeout(() => {
          const inserido = editor.getValue().length - antes + sobrescrito;
          if (inserido < 20) return;
          this.mostrarBotaoColar(editor, inicio, inicio + inserido);
        }, 150);
      })
    );

    this.registerDomEvent(document, "mouseup", () => setTimeout(() => this.atualizarBarra(), 10));
    this.registerDomEvent(document, "keyup", (e) => {
      if (e.shiftKey || e.key.startsWith("Arrow") || e.key === "Escape") this.atualizarBarra();
    });
    this.registerDomEvent(document, "mousedown", (e) => {
      const dentro = (el) => el && el.contains(e.target);
      if (!dentro(this.barra)) this.esconderBarra();
      if (!dentro(this.botaoColar)) this.esconderBotaoColar();
    });
    this.registerDomEvent(document, "keydown", (e) => {
      if (["Shift", "Control", "Meta", "Alt"].includes(e.key)) return;
      this.esconderBotaoColar();
    });
  }

  onunload() {
    this.esconderBarra();
    this.esconderBotaoColar();
  }

  formatarSelecao(editor) {
    if (editor.somethingSelected()) {
      editor.replaceSelection(limparTexto(editor.getSelection()));
    } else {
      const cursor = editor.getCursor();
      editor.setValue(limparTexto(editor.getValue()));
      editor.setCursor(cursor);
    }
    new Notice("Texto formatado");
  }

  atualizarBarra() {
    if (!this.settings.barraAoSelecionar) return;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const sel = window.getSelection();
    if (!view || !sel || sel.rangeCount === 0 || sel.isCollapsed) return this.esconderBarra();
    if (!view.contentEl.contains(sel.anchorNode) || !view.editor.somethingSelected()) {
      return this.esconderBarra();
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) return this.esconderBarra();
    this.mostrarBarra(view.editor, rect);
  }

  mostrarBarra(editor, rect) {
    this.esconderBarra();
    const barra = document.body.createDiv({ cls: "fdt-barra" });
    barra.addEventListener("mousedown", (e) => e.preventDefault());
    for (const b of BOTOES) {
      if (!b) {
        barra.createDiv({ cls: "fdt-sep" });
        continue;
      }
      const el = barra.createEl("button", { text: b.r, attr: { "aria-label": b.t, title: b.t } });
      if (b.estilo) el.setAttribute("style", b.estilo);
      el.addEventListener("click", () => {
        if (b.f === "formatar") this.formatarSelecao(editor);
        else b.f(editor);
        setTimeout(() => this.atualizarBarra(), 10);
      });
    }
    this.barra = barra;
    const larg = barra.offsetWidth;
    const alt = barra.offsetHeight;
    let topo = rect.top - alt - 8;
    if (topo < 4) topo = rect.bottom + 8;
    const esquerda = Math.min(Math.max(4, rect.left + rect.width / 2 - larg / 2), window.innerWidth - larg - 4);
    barra.style.top = topo + "px";
    barra.style.left = esquerda + "px";
  }

  esconderBarra() {
    if (this.barra) this.barra.remove();
    this.barra = null;
  }

  mostrarBotaoColar(editor, inicio, fim) {
    this.esconderBotaoColar();
    let x = window.innerWidth / 2 - 60;
    let y = window.innerHeight / 2;
    try {
      const c = editor.cm.coordsAtPos(Math.min(fim, editor.getValue().length));
      if (c) {
        x = c.left;
        y = c.bottom + 6;
      }
    } catch (e) {}
    const caixa = document.body.createDiv({ cls: "fdt-colar" });
    caixa.style.left = Math.max(4, Math.min(x, window.innerWidth - 160)) + "px";
    caixa.style.top = Math.min(y, window.innerHeight - 44) + "px";
    caixa.addEventListener("mousedown", (e) => e.preventDefault());
    const formatar = caixa.createEl("button", { text: "✨ Formatar", cls: "fdt-principal" });
    formatar.addEventListener("click", () => {
      const de = editor.offsetToPos(inicio);
      const ate = editor.offsetToPos(fim);
      editor.replaceRange(limparTexto(editor.getRange(de, ate)), de, ate);
      new Notice("Texto formatado");
      this.esconderBotaoColar();
    });
    const fechar = caixa.createEl("button", { text: "✕", attr: { "aria-label": "Fechar" } });
    fechar.addEventListener("click", () => this.esconderBotaoColar());
    this.botaoColar = caixa;
    this.temporizador = setTimeout(() => this.esconderBotaoColar(), 12000);
  }

  esconderBotaoColar() {
    clearTimeout(this.temporizador);
    if (this.botaoColar) this.botaoColar.remove();
    this.botaoColar = null;
  }
};

class AbaConfiguracoes extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const opcoes = [
      ["botaoAoColar", "Botão Formatar ao colar", "Mostra um botão perto do texto recém-colado."],
      ["barraAoSelecionar", "Barra ao selecionar texto", "Mostra a barra de formatação sobre a seleção."],
    ];
    for (const [chave, nome, desc] of opcoes) {
      new Setting(containerEl)
        .setName(nome)
        .setDesc(desc)
        .addToggle((t) =>
          t.setValue(this.plugin.settings[chave]).onChange(async (v) => {
            this.plugin.settings[chave] = v;
            await this.plugin.saveData(this.plugin.settings);
          })
        );
    }
  }
}

module.exports.limparTexto = limparTexto;
