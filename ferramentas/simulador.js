// =====================================================================
//  Simulador de balanceamento: Tiozão Idle Miner
//  Roda o próprio game.js no Node (com uma "tela falsa") e um jogador robô.
//  Uso: node ferramentas/simulador.js [minutos]   (padrão: 30)
//  Mede: $ por minuto, quando abre cada andar e onde o minério acumula (gargalo).
// =====================================================================
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const MINUTOS = Number(process.argv[2]) || 30;
const QUADROS_POR_SEG = 60;

// ---------- Tela falsa: só o necessário para o game.js rodar ----------
function elementoFalso() {
  const el = {
    style: {}, dataset: {}, children: [], textContent: "", className: "", disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(f) { this.children.push(f); return f; },
    remove() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    insertAdjacentHTML() {},
    querySelector() { return elementoFalso(); },
    querySelectorAll() { return []; },
    set innerHTML(v) { this.children = []; }, get innerHTML() { return ""; }
  };
  return el;
}
const porId = {};
const contexto = {
  console, Math, JSON, Number, String, Array, Object, Infinity,
  document: {
    getElementById(id) { return porId[id] || (porId[id] = elementoFalso()); },
    createElement() { return elementoFalso(); },
    querySelector() { return elementoFalso(); },
    body: elementoFalso()
  },
  window: { addEventListener() {}, innerWidth: 1000, innerHeight: 600 },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  location: { reload() {} },
  requestAnimationFrame() {}, setTimeout() {}, setInterval() {}, confirm() { return false; }
};
vm.createContext(contexto);
const codigo = fs.readFileSync(path.join(__dirname, "..", "game.js"), "utf8");
// "const"/"let" do jogo não viram globais do contexto; expomos o que o robô usa
vm.runInContext(codigo + `
;globalThis.J = {
  get dinheiro() { return dinheiro; }, set dinheiro(v) { dinheiro = v; },
  get noDeposito() { return noDeposito; },
  andares, elev, aj, gerentes, niveis,
  automatizar, moverAndar, moverElevador, moverAjudante,
  clicarAndar, clicarElevador, clicarAjudante, adicionarAndar,
  precoNiveis, precoGerente, precoMineiro, precoNovoAndar, nivelDe, subirNivel,
  capSacola, capElevador, capCarrinho, extracaoPorSegundo, MAX_ANDARES, MAX_MINEIROS, estacoes,
  get tempo() { return tempo; }, set tempo(v) { tempo = v; }
};`, contexto);
const J = contexto.J;

// ---------- Proposta de números (só no simulador): node ferramentas/simulador.js 30 proposta ----------
// Mude aqui para testar; quando aprovado, os mesmos números vão para o game.js.
if (process.argv[3] === "proposta") {
  // Números da proposta (dá para trocar pela linha de comando, ex.: VALOR=1.08 PRECO=1.15 node ...)
  const PISO = Number(process.env.PISO) || 5;                // cada andar mais fundo: minério ×PISO e preços ×PISO
  const VALOR = Number(process.env.VALOR) || 1.06;           // quanto cada nível melhora o andar
  const VALOR_TRANSP = Number(process.env.TRANSP) || 1.16;   // quanto cada nível melhora elevador/carrinho
  const PRECO = Number(process.env.PRECO) || 1.16;           // quanto o preço do próximo nível sobe
  const PRECO_ANDAR = Number(process.env.PRECO_ANDAR) || 12; // abrir o próximo andar: ×PRECO_ANDAR
  J.precoNiveis = function (tipo, i, n, k) {
    const base = J.estacoes[tipo].precoBase(i) * PRECO ** n;
    return Math.ceil(base * (PRECO ** k - 1) / (PRECO - 1));
  };
  const E = J.estacoes;
  E.andar.precoBase = function (i) { return 10 * PISO ** i; };
  E.andar.stats = function (n, i) {
    return [
      { nome: "Minério por golpe", icone: "", v: 2 * PISO ** i * VALOR ** n },
      { nome: "Sacola por mineiro", icone: "", v: 20 * PISO ** i * VALOR ** n }
    ];
  };
  E.elevador.stats = function (n) {
    return [{ nome: "Carga", icone: "", v: 40 * VALOR_TRANSP ** n }, { nome: "Velocidade", icone: "", v: 100 * 1.03 ** n }];
  };
  E.superficie.stats = function (n) {
    return [{ nome: "Carrinho", icone: "", v: 20 * VALOR_TRANSP ** n }, { nome: "Velocidade", icone: "", v: 100 * 1.03 ** n }];
  };
  J.precoMineiro = function (i) { return Math.floor(50 * 2 ** (J.andares[i].mineiros - 1) * PISO ** i); };
  J.precoGerente = function (tipo, i) { return tipo === "superficie" ? 100 : tipo === "elevador" ? 150 : 75 * PISO ** i; };
  J.precoNovoAndar = function () { return 100 * PRECO_ANDAR ** (J.andares.length - 1); };
}

// ---------- Jogador robô ----------
// Antes dos gerentes: clica em tudo assim que dá (jogador ativo).
// Compra: gerentes primeiro; depois melhora a estação que é o gargalo.
function clicarComoJogador() {
  J.andares.forEach(function (a, i) { if (a.sacola >= J.capSacola(a)) { J.clicarAndar(i); } });
  J.clicarElevador();
  J.clicarAjudante();
}

function comprar(custo) {
  if (J.dinheiro < custo) { return false; }
  J.dinheiro = J.dinheiro - custo;
  return true;
}

// Produção real de um andar por segundo: cavar até encher + ida e volta até a caixa
const IDA_E_VOLTA = 2 * (608 - 170) / 3 / QUADROS_POR_SEG; // segundos (X_PAREDE, X_POCO, VEL_MINEIRO)
function producaoReal(i, n, mineiros) {
  const s = J.estacoes.andar.stats(n, i);
  const porSeg = s[0].v * mineiros * 2;   // 2 golpes por segundo
  const sacola = s[1].v * mineiros;
  return sacola / (sacola / porSeg + IDA_E_VOLTA);
}

// Quanto cada etapa consegue mover por segundo (estimativa a partir da medição)
let janela = { caixas: 0, deposito: 0 }; // acumulado no começo da janela de 10 s
let ocupado = { elev: 0, aj: 0 };         // fração do tempo ocupado na última janela de 10 s
let contaJanela = { elev: 0, aj: 0 };
let cheio = { elev: 0, aj: 0 };           // carga média das viagens (0 a 1) na última janela
let viagens = { elev: [], aj: [] };
function totalCaixas() { return J.andares.reduce(function (s, a) { return s + a.caixa; }, 0); }

function decidirCompra(eventos, seg) {
  // 1) Gerentes (automação) assim que der
  if (!J.gerentes.superficie && comprar(J.precoGerente("superficie", 0))) { J.gerentes.superficie = true; eventos.push([seg, "gerente superfície"]); return true; }
  if (!J.gerentes.elevador && comprar(J.precoGerente("elevador", 0))) { J.gerentes.elevador = true; eventos.push([seg, "gerente elevador"]); return true; }
  for (let i = 0; i < J.andares.length; i++) {
    const a = J.andares[i];
    if (!a.gerente && comprar(J.precoGerente("andar", i))) { a.gerente = true; eventos.push([seg, "gerente andar " + (i + 1)]); return true; }
  }

  // 2) Gargalo: onde o minério está acumulando? (mais que 2 viagens parado e ainda subindo)
  //    ou o transporte está sempre ocupado E viajando cheio (mais de 90% da carga) nos últimos 10 s.
  const cresceCaixas = (totalCaixas() > 2 * J.capElevador() && totalCaixas() > janela.caixas) || (ocupado.elev > 0.9 && cheio.elev > 0.9);
  const cresceDeposito = (J.noDeposito > 2 * J.capCarrinho() && J.noDeposito > janela.deposito) || (ocupado.aj > 0.9 && cheio.aj > 0.9);
  if (cresceCaixas > 0 && J.dinheiro >= J.precoNiveis("elevador", 0, J.niveis.elevador, 1)) {
    comprar(J.precoNiveis("elevador", 0, J.niveis.elevador, 1)); J.subirNivel("elevador", 0, 1); return true;
  }
  if (cresceDeposito > 0 && J.dinheiro >= J.precoNiveis("superficie", 0, J.niveis.superficie, 1)) {
    comprar(J.precoNiveis("superficie", 0, J.niveis.superficie, 1)); J.subirNivel("superficie", 0, 1); return true;
  }
  if (cresceCaixas > 0 || cresceDeposito > 0) { return false; } // guarda dinheiro para o gargalo

  // 3) Sem gargalo: novo andar se custar até 2 min de renda; senão o melhor custo-benefício
  const opcoes = [];
  if (J.andares.length < J.MAX_ANDARES) {
    // ganho do andar novo: o que ele extrai no nível 1 com 1 mineiro (2 golpes por segundo)
    const ganhoAndar = producaoReal(J.andares.length, 0, 1);
    opcoes.push({ nome: "andar", custo: J.precoNovoAndar(), ganho: ganhoAndar, fazer() { J.adicionarAndar(); eventos.push([seg, "abriu andar " + J.andares.length]); } });
  }
  J.andares.forEach(function (a, i) {
    const agora = producaoReal(i, a.nivel, a.mineiros);
    opcoes.push({ nome: "nivel andar " + (i + 1), custo: J.precoNiveis("andar", i, a.nivel, 1),
                  ganho: producaoReal(i, a.nivel + 1, a.mineiros) - agora, fazer() { J.subirNivel("andar", i, 1); } });
    if (a.gerente && a.mineiros < J.MAX_MINEIROS) {
      opcoes.push({ nome: "mineiro andar " + (i + 1), custo: J.precoMineiro(i), ganho: producaoReal(i, a.nivel, a.mineiros + 1) - agora,
                    fazer() { a.mineiros++; eventos.push([seg, "mineiro " + a.mineiros + " no andar " + (i + 1)]); } });
    }
  });
  opcoes.sort(function (x, y) { return x.custo / x.ganho - y.custo / y.ganho; });
  const melhor = opcoes[0];
  if (melhor && comprar(melhor.custo)) { melhor.fazer(); return true; }
  return false;
}

// ---------- Simulação ----------
// (o game.js já cria o andar 1 ao carregar, porque não há save)
const eventos = [];
const porMinuto = [];
let dinheiroGanho = 0, ultimoDinheiro = 0;
let elevOcupado = 0, ajOcupado = 0;

for (let q = 0; q < MINUTOS * 60 * QUADROS_POR_SEG; q++) {
  const antes = J.dinheiro;
  J.tempo = J.tempo + 1;
  const ajAntes = J.aj.estado; // antes dos cliques, para ver o carrinho saindo
  clicarComoJogador();
  J.automatizar();
  J.andares.forEach(J.moverAndar);
  J.moverElevador();
  J.moverAjudante();
  // Viagens: elevador chegou em cima com carga / carrinho saiu com carga
  if (J.elev.estado === "topo" && J.elev.carga > 0) { viagens.elev.push(J.elev.carga / J.capElevador()); }
  if (ajAntes === "parado" && J.aj.estado === "indo") { viagens.aj.push(J.aj.carga / J.capCarrinho()); }
  if (J.dinheiro > antes) { dinheiroGanho += J.dinheiro - antes; }
  if (J.elev.estado !== "topo") { elevOcupado++; contaJanela.elev++; }
  if (J.aj.estado !== "parado") { ajOcupado++; contaJanela.aj++; }

  const seg = q / QUADROS_POR_SEG;
  if (q % QUADROS_POR_SEG === 0) { // a cada segundo o robô tenta comprar (várias vezes)
    for (let t = 0; t < 20 && decidirCompra(eventos, seg); t++) { /* compra o que der */ }
  }
  if (q % (10 * QUADROS_POR_SEG) === 0 && q > 0) {
    janela = { caixas: totalCaixas(), deposito: J.noDeposito };
    const tam = 10 * QUADROS_POR_SEG;
    ocupado = { elev: contaJanela.elev / tam, aj: contaJanela.aj / tam };
    contaJanela = { elev: 0, aj: 0 };
    const media = function (l) { return l.length ? l.reduce(function (x, y) { return x + y; }, 0) / l.length : 0; };
    cheio = { elev: media(viagens.elev), aj: media(viagens.aj) };
    viagens = { elev: [], aj: [] };
  }

  if ((q + 1) % (60 * QUADROS_POR_SEG) === 0) {
    const min = (q + 1) / (60 * QUADROS_POR_SEG);
    const q1 = 60 * QUADROS_POR_SEG;
    porMinuto.push({
      min,
      renda: Math.round(dinheiroGanho - ultimoDinheiro),
      andares: J.andares.map(function (a) { return a.nivel + 1 + (a.mineiros > 1 ? "×" + a.mineiros : ""); }).join(" "),
      elev: J.niveis.elevador + 1, sup: J.niveis.superficie + 1,
      caixas: Math.round(totalCaixas()), deposito: Math.round(J.noDeposito),
      elevOcup: Math.round(elevOcupado / q1 * 100), ajOcup: Math.round(ajOcupado / q1 * 100)
    });
    ultimoDinheiro = dinheiroGanho; elevOcupado = 0; ajOcupado = 0;
  }
}

// ---------- Relatório ----------
const linhas = [];
linhas.push("SIMULADOR: " + MINUTOS + " min de jogo");
linhas.push("");
linhas.push("min | renda $/min | níveis dos andares (×mineiros) | elev | sup | minério nas caixas | no depósito | elevador ocupado | carrinho ocupado");
porMinuto.forEach(function (m) {
  if (m.min <= 10 || m.min % 5 === 0) {
    linhas.push([m.min, m.renda, m.andares, m.elev, m.sup, m.caixas, m.deposito, m.elevOcup + "%", m.ajOcup + "%"].join(" | "));
  }
});
linhas.push("");
linhas.push("Marcos:");
eventos.forEach(function (e) { linhas.push("  " + Math.floor(e[0] / 60) + ":" + String(Math.floor(e[0] % 60)).padStart(2, "0") + "  " + e[1]); });
if (process.env.RESUMO) { // uma linha só, para comparar variantes
  const marco = function (txt) { const e = eventos.find(function (x) { return x[1] === txt; }); return e ? (e[0] / 60).toFixed(1) : "-"; };
  const r = function (m) { const x = porMinuto[m - 1]; return x ? x.renda : "-"; };
  const maxNivel = Math.max.apply(null, J.andares.map(function (a) { return a.nivel + 1; }));
  console.log(["andar2=" + marco("abriu andar 2"), "3=" + marco("abriu andar 3"), "4=" + marco("abriu andar 4"),
               "5=" + marco("abriu andar 5"), "6=" + marco("abriu andar 6"), "7=" + marco("abriu andar 7"),
               "| renda@5=" + r(5), "@15=" + r(15), "@30=" + r(30), "| nível máx=" + maxNivel].join(" "));
} else {
  console.log(linhas.join("\n"));
}
