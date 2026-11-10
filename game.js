// =====================================================================
//  Tiozão Idle Miner: game.js
//  Cadeia: mineiros → elevador (para em cada andar) → depósito → ajudante → fábrica → $
//  Regras: o mineiro cava sozinho; o clique manda levar até a caixa do andar.
//  Elevador e ajudante: um clique = uma viagem. O gerente faz os cliques da estação.
//  Cada estação tem UM nível, que melhora todos os números dela.
// =====================================================================

// ===== Layout do mundo (ver plano) =====
const ALTURA_TELA = 540;
const ALTURA_SUPERFICIE = 230;   // bloco da superfície
const ALTURA_ANDAR = 250;        // bloco de cada andar
const MAX_ANDARES = 10;
const MAX_MINEIROS = 3;          // por andar

const X_PAREDE = 608;            // mineiro da frente cavando
const X_POCO = 170;              // mineiro da frente na beira do poço
const OFFSET_MINEIRO = [0, 22, 44]; // os outros mineiros ficam um pouco atrás
const VEL_MINEIRO = 3;           // pixels por quadro

const Y_TOPO_ELEVADOR = 84;      // cabine na superfície
const VEL_ELEVADOR = 3;          // pixels por quadro
const PARADA_ANDAR = 20;         // quadros parado num andar com minério, carregando (~0,3 s)

const X_AJ_DEPOSITO = 360;       // ajudante parado ao lado do depósito
const X_AJ_FABRICA = 560;        // carrinho na porta da fábrica
const VEL_AJUDANTE = 2.5;

const RITMO_GOLPE = 30;          // mineiros cavam sozinhos: um golpe a cada 30 quadros (~0,5 s)

function topoAndar(i) { return ALTURA_SUPERFICIE + i * ALTURA_ANDAR; }
function yCabineNoAndar(i) { return topoAndar(i) + 114; } // piso da cabine no chão do andar

// ===== Níveis das estações (regra da proporção) =====
// Números do balanceamento (testados no simulador: ferramentas/simulador.js, em 2026-11-10).
// Andar: produção +6% por nível. Elevador e carrinho: carga +16% por nível (mesmo ritmo do preço).
// Cada andar mais fundo: minério, sacola e preços ×PISO. Abrir andar: ×PRECO_ANDAR.
const PISO = 5;               // andar mais fundo vale ×5
const CRESCE_ANDAR = 1.06;    // +6% de produção por nível
const CRESCE_TRANSP = 1.16;   // +16% de carga por nível (elevador e carrinho)
const PRECO_CRESCE = 1.16;    // +16% de preço por nível
const PRECO_ANDAR = 12;       // abrir o próximo andar custa ×12

const estacoes = {
  andar: {
    precoBase: function (i) { return 10 * PISO ** i; },        // andar mais fundo = mais caro
    stats: function (n, i) {
      return [
        { nome: "Minério por golpe", icone: "pedra-minerio.svg", v: 2 * PISO ** i * CRESCE_ANDAR ** n },
        { nome: "Sacola por mineiro", icone: "sacola.svg", v: 20 * PISO ** i * CRESCE_ANDAR ** n }
      ];
    }
  },
  elevador: {
    precoBase: function () { return 20; },
    stats: function (n) {
      return [
        { nome: "Carga", icone: "elevador-cheio.svg", v: 40 * CRESCE_TRANSP ** n },
        { nome: "Velocidade", icone: "elevador-vazio.svg", v: 100 * 1.03 ** n, sufixo: "%" }
      ];
    }
  },
  superficie: {
    precoBase: function () { return 15; },
    stats: function (n) {
      return [
        { nome: "Carga do carrinho", icone: "ajudante-andando-cheio-1.svg", v: 20 * CRESCE_TRANSP ** n },
        { nome: "Velocidade", icone: "ajudante-parado.svg", v: 100 * 1.03 ** n, sufixo: "%" }
      ];
    }
  }
};

// Preço para subir k níveis a partir do nível n (soma de uma progressão geométrica)
function precoNiveis(tipo, i, n, k) {
  const base = estacoes[tipo].precoBase(i) * PRECO_CRESCE ** n;
  return Math.ceil(base * (PRECO_CRESCE ** k - 1) / (PRECO_CRESCE - 1));
}

// Quantos níveis dá para comprar com o dinheiro atual (para o botão "Max")
function niveisQueDaPraComprar(tipo, i, n) {
  let k = 0;
  while (k < 1000 && precoNiveis(tipo, i, n, k + 1) <= dinheiro) { k++; }
  return k;
}

// Nível atual de uma estação (começa em 0; na tela aparece +1)
function nivelDe(tipo, i) {
  if (tipo === "andar") { return andares[i].nivel; }
  return niveis[tipo];
}
function subirNivel(tipo, i, k) {
  if (tipo === "andar") { andares[i].nivel += k; } else { niveis[tipo] += k; }
}
// Valor de um número da estação no nível atual (posição na lista de stats)
function stat(tipo, i, pos) { return estacoes[tipo].stats(nivelDe(tipo, i), i)[pos].v; }

function capElevador() { return Math.floor(stat("elevador", 0, 0)); }
function velElevador() { return VEL_ELEVADOR * stat("elevador", 0, 1) / 100; }
function capCarrinho() { return Math.floor(stat("superficie", 0, 0)); }
function velAjudante() { return VEL_AJUDANTE * stat("superficie", 0, 1) / 100; }

// Contratar mineiro no andar i: 50 × 2^(mineiros-1) × 5^i
function precoMineiro(i) { return Math.floor(50 * 2 ** (andares[i].mineiros - 1) * PISO ** i); }
// Abrir o próximo andar: 100, 1.200, 14.400... (×PRECO_ANDAR)
function precoNovoAndar() { return 100 * PRECO_ANDAR ** (andares.length - 1); }

// Gerentes (opção A: só automatizam). Superfície 100, elevador 150, andar N: 75 × 5^(N-1)
function precoGerente(tipo, i) {
  if (tipo === "superficie") { return 100; }
  if (tipo === "elevador") { return 150; }
  return 75 * PISO ** i;
}

// ===== Estado do jogo =====
let dinheiro = 0;
let noDeposito = 0;
let tempo = 0;          // contador de quadros (anima as caminhadas)
let cameraY = 0;        // quanto o mundo está rolado para baixo
const andares = [];     // cada andar: { nivel, mineiros, sacola, caixa, estado, x, golpe, ... }
const elev = { y: Y_TOPO_ELEVADOR, estado: "topo", carga: 0, alvo: 0, espera: 0 };
// estados do elevador: "topo" (parado em cima), "descendo", "parado" (num andar), "subindo"
const aj = { x: X_AJ_DEPOSITO, estado: "parado", carga: 0 };
const gerentes = { elevador: false, superficie: false }; // os de andar ficam em cada andar
const niveis = { elevador: 0, superficie: 0 };           // os de andar ficam em cada andar

// ===== Peças fixas da tela =====
const jogo = document.getElementById("jogo");
const mundo = document.getElementById("mundo");
const containerAndares = document.getElementById("andares");
const textoDinheiro = document.getElementById("dinheiro");
const elevador = document.getElementById("elevador");
const cabo = document.getElementById("cabo");
const balaoElevador = document.getElementById("balao-elevador");
const deposito = document.getElementById("deposito");
const balaoDeposito = document.getElementById("balao-deposito");
const ajudante = document.getElementById("ajudante");
const maisElevador = document.getElementById("mais-elevador");
const maisSuperficie = document.getElementById("mais-superficie");
const gerenteElevador = document.getElementById("gerente-elevador");
const gerenteSuperficie = document.getElementById("gerente-superficie");
const andarBloqueado = document.getElementById("andar-bloqueado");
const maisAndar = document.getElementById("mais-andar");
const rotuloAndar = document.getElementById("rotulo-andar");
const rolarCima = document.getElementById("rolar-cima");
const rolarBaixo = document.getElementById("rolar-baixo");
const painel = document.getElementById("painel");
const painelTitulo = document.getElementById("painel-titulo");
const painelLinhas = document.getElementById("painel-linhas");

// ===== Utilidades =====
function formatar(n) { return Math.floor(n).toLocaleString("pt-BR"); }
// Números do painel: 1 casa decimal quando é pequeno e quebrado (ex.: 1,1)
function formatarStat(n) {
  if (n < 100 && Math.abs(n - Math.round(n)) > 0.05) {
    return n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }
  return formatar(Math.round(n));
}

function trocarImagem(img, nome) {
  const caminho = "assets/" + nome;
  if (img.getAttribute("src") !== caminho) { img.src = caminho; } // só troca se mudou
}

function trocarTexto(el, texto) {
  if (el.textContent !== texto) { el.textContent = texto; }
}

function criar(tag, classe, pai) {
  const el = document.createElement(tag);
  if (classe) { el.className = classe; }
  pai.appendChild(el);
  return el;
}

// Balão: texto + cor ("", "amarelo", "laranja" ou "vermelho")
function mudarBalao(el, texto, cor) {
  trocarTexto(el, texto);
  ["amarelo", "laranja", "vermelho"].forEach(function (c) { el.classList.toggle(c, c === cor); }); // mantém as outras classes
}

// Texto "+N" flutuando em qualquer ponto do mundo
function mostrarTexto(texto, left, top) {
  const div = criar("div", "ganho", mundo);
  div.textContent = texto;
  div.style.left = left + "px";
  div.style.top = top + "px";
  setTimeout(function () { div.remove(); }, 800);
}

// Pedra saltando da parede
function mostrarPedra(left, top) {
  const pedra = criar("img", "pedra", mundo);
  pedra.src = "assets/pedra-minerio.svg";
  pedra.style.left = left + "px";
  pedra.style.top = top + "px";
  setTimeout(function () { pedra.remove(); }, 600);
}

// =====================================================================
//  ANDARES
// =====================================================================
function capSacola(a) { return Math.floor(estacoes.andar.stats(a.nivel, a.i)[1].v * a.mineiros); }

// Quanto entra por golpe no andar: minério por golpe × mineiros (o andar mais fundo vale mais)
function ganhoPorGolpe(a) { return estacoes.andar.stats(a.nivel, a.i)[0].v * a.mineiros; }

// Extração por segundo (painel): golpe × mineiros × golpes por segundo
function extracaoPorSegundo(a, n) {
  return estacoes.andar.stats(n, a.i)[0].v * a.mineiros * (60 / RITMO_GOLPE);
}

function adicionarAndar() {
  const i = andares.length;
  const div = criar("div", "andar", containerAndares);
  div.style.top = topoAndar(i) + "px";

  const fundo = criar("img", "fundo-andar", div);
  fundo.src = "assets/fundo-andar.svg";

  const numero = criar("div", "numero-andar", div);
  numero.textContent = i + 1;

  // Até 3 mineiros (criados de trás para frente, para o da frente ficar por cima)
  const imgs = [];
  for (let k = MAX_MINEIROS - 1; k >= 0; k--) {
    const img = criar("img", "mineiro", div);
    img.src = "assets/mineiro-parado.svg";
    img.addEventListener("click", function () { clicarAndar(i); });
    imgs[k] = img;
  }

  // Barra de progresso da sacola (fica em cima dos mineiros)
  const barra = criar("div", "barra", div);
  const barraCheia = criar("div", "barra-cheia", barra);
  const barraTexto = criar("span", "barra-texto", barra);

  // Caixa na beira do poço: o mineiro despeja aqui e volta a cavar
  const caixa = criar("img", "caixa", div);
  caixa.src = "assets/deposito-vazio.svg";
  const balaoCaixa = criar("div", "balao balao-caixa", div);

  const imgGerente = criar("img", "gerente", div); // aparece quando contratado
  imgGerente.src = "assets/gerente.svg";

  const mais = criar("button", "botao-mais", div);
  mais.textContent = "+";
  criar("span", "selo", mais);
  mais.addEventListener("click", function () { abrirPainel("andar", i); });

  andares.push({ i: i, nivel: 0, mineiros: 1, sacola: 0, caixa: 0, estado: "cavando", x: X_PAREDE, golpe: 0,
                 gerente: false, relogio: 0, // gerente: leva sozinho e libera mineiros extras
                 imgs: imgs, barra: barra, barraCheia: barraCheia, barraTexto: barraTexto,
                 imgCaixa: caixa, balaoCaixa: balaoCaixa, mais: mais, imgGerente: imgGerente });
  atualizarVagaDoProximoAndar();
}

function alturaMundo() {
  const temVaga = andares.length < MAX_ANDARES;
  return topoAndar(andares.length) + (temVaga ? ALTURA_ANDAR : 0) + 30;
}

function atualizarVagaDoProximoAndar() {
  if (andares.length >= MAX_ANDARES) {
    andarBloqueado.style.display = "none";
  } else {
    andarBloqueado.style.display = "block";
    andarBloqueado.style.top = topoAndar(andares.length) + "px";
  }
  mundo.style.height = alturaMundo() + "px";
}

// Clique nos mineiros: levam o que tem na sacola até a caixa do andar
function clicarAndar(i) {
  const a = andares[i];
  if (a.estado !== "cavando" || a.sacola <= 0) { return; }
  a.estado = "indo";
}

// Golpe automático (todos os mineiros juntos), até a sacola encher
function cavar(a) {
  const cap = capSacola(a);
  if (a.sacola >= cap) { return; }
  const ganho = Math.min(ganhoPorGolpe(a), cap - a.sacola); // o excesso é perdido
  a.sacola = a.sacola + ganho;
  a.golpe = 9; // pose "trabalhando" por 9 quadros (~0,15 s)
  // Efeitos só no andar que está na tela
  const topo = topoAndar(a.i);
  if (topo + ALTURA_ANDAR > cameraY && topo < cameraY + ALTURA_TELA) {
    mostrarPedra(740, topo + 170);
    mostrarTexto("+" + formatarStat(ganho), 760, topo + 110);
  }
}

function moverAndar(a) {
  if (a.golpe > 0) { a.golpe--; }

  if (a.estado === "cavando") {
    a.relogio++;
    if (a.relogio >= RITMO_GOLPE) { a.relogio = 0; cavar(a); }
  } else if (a.estado === "indo") {
    a.x = a.x - VEL_MINEIRO;
    if (a.x <= X_POCO) {
      a.x = X_POCO;
      a.caixa = a.caixa + a.sacola; // despeja na caixa e volta, sem esperar o elevador
      a.sacola = 0;
      a.estado = "voltando";
    }
  } else if (a.estado === "voltando") {
    a.x = a.x + VEL_MINEIRO;
    if (a.x >= X_PAREDE) {
      a.x = X_PAREDE;
      a.estado = "cavando";
    }
  }
}

function desenharAndar(a, i) {
  for (let k = 0; k < MAX_MINEIROS; k++) {
    const img = a.imgs[k];
    if (k >= a.mineiros) { img.style.display = "none"; continue; }
    img.style.display = "";

    const passo = Math.floor((tempo + k * 5) / 10) % 2 + 1; // cada um num passo diferente
    let nome = "mineiro-parado.svg";
    let espelhado = false;
    if (a.estado === "cavando") {
      nome = a.golpe > 0 ? "mineiro-trabalhando.svg" : "mineiro-parado.svg";
    } else if (a.estado === "indo") {
      nome = "mineiro-andando-" + passo + ".svg";
      espelhado = true;
    } else if (a.estado === "voltando") {
      nome = "mineiro-andando-vazio-" + passo + ".svg";
    }
    trocarImagem(img, nome);
    img.style.left = (a.x + OFFSET_MINEIRO[k]) + "px";
    img.style.transform = espelhado ? "scaleX(-1)" : "none";
  }

  // Barra de progresso da sacola
  const cap = capSacola(a);
  const cheia = a.sacola >= cap;
  a.barraCheia.style.width = Math.min(100, a.sacola / cap * 100) + "%";
  trocarTexto(a.barraTexto, cheia && a.estado === "cavando" ? "Levar!" : formatar(a.sacola) + "/" + formatar(cap));
  a.barra.classList.toggle("cheia", cheia && a.estado === "cavando");
  a.barra.style.left = (a.x + 75 + OFFSET_MINEIRO[a.mineiros - 1] / 2) + "px";

  // Caixa do andar
  trocarImagem(a.imgCaixa, a.caixa > 0 ? "deposito-cheio.svg" : "deposito-vazio.svg");
  mudarBalao(a.balaoCaixa, formatar(a.caixa), a.caixa > 0 ? "amarelo" : "");

  a.imgGerente.classList.toggle("contratado", a.gerente);

  // Botão "+": selo com a equipe e pulsa se dá para comprar algo
  trocarTexto(a.mais.querySelector(".selo"), "Nv " + (a.nivel + 1));
  a.mais.classList.toggle("pode", podeComprarAlgo("andar", i));
}

// =====================================================================
//  ELEVADOR: desce parando em cada andar, sobe e despeja no depósito
// =====================================================================
// Primeiro andar (a partir de "inicio") com minério na caixa; -1 se nenhum
function proximoAndarComMinerio(inicio) {
  for (let j = inicio; j < andares.length; j++) {
    if (andares[j].caixa >= 1) { return j; }
  }
  return -1;
}

function clicarElevador() {
  // Só sai da superfície, vazio (se ainda tem carga, o depósito está lotado)
  if (elev.estado !== "topo" || elev.carga > 0) { return; }
  // Só desce se algum andar tem minério esperando
  const primeiro = proximoAndarComMinerio(0);
  if (primeiro < 0) { return; }
  elev.alvo = primeiro;
  elev.estado = "descendo";
}

function moverElevador() {
  const cap = capElevador();

  if (elev.estado === "descendo") {
    elev.y = elev.y + velElevador();
    const yAlvo = yCabineNoAndar(elev.alvo);
    if (elev.y >= yAlvo) {
      elev.y = yAlvo;
      elev.estado = "parado";
      elev.espera = PARADA_ANDAR;
    }

  } else if (elev.estado === "parado") {
    // Recolhe da caixa deste andar (até encher a cabine)
    const a = andares[elev.alvo];
    if (elev.carga < cap) {
      const pega = Math.min(a.caixa, cap - elev.carga);
      elev.carga = elev.carga + pega;
      a.caixa = a.caixa - pega;
    }
    elev.espera--;
    if (elev.espera <= 0) {
      // Cabine cheia ou nenhum andar abaixo com minério: sobe.
      // Senão, desce direto até o próximo andar que tem minério (passa pelos outros).
      const proximo = proximoAndarComMinerio(elev.alvo + 1);
      if (elev.carga >= cap || proximo < 0) {
        elev.estado = "subindo";
      } else {
        elev.alvo = proximo;
        elev.estado = "descendo";
      }
    }

  } else if (elev.estado === "subindo") {
    elev.y = elev.y - velElevador();
    if (elev.y <= Y_TOPO_ELEVADOR) {
      elev.y = Y_TOPO_ELEVADOR;
      elev.estado = "topo";
    }

  } else if (elev.estado === "topo" && elev.carga > 0) {
    // Despeja tudo no depósito (regra: guardar é infinito; quem limita é o transporte)
    noDeposito = noDeposito + elev.carga;
    elev.carga = 0;
  }
}

function desenharElevador() {
  const cap = capElevador();
  trocarImagem(elevador, elev.carga > 0 ? "elevador-cheio.svg" : "elevador-vazio.svg");
  elevador.style.top = elev.y + "px";
  cabo.style.height = (elev.y - 116) + "px"; // da roldana até a cabine

  mudarBalao(balaoElevador, formatar(elev.carga) + "/" + formatar(cap), elev.carga > 0 ? "amarelo" : "");
  balaoElevador.style.top = (elev.y - 30) + "px";
  elevador.style.cursor = (elev.estado === "topo" && elev.carga === 0) ? "pointer" : "default";

  gerenteElevador.classList.toggle("contratado", gerentes.elevador);
  trocarTexto(maisElevador.querySelector(".selo"), "Nv " + (niveis.elevador + 1));
  maisElevador.classList.toggle("pode", podeComprarAlgo("elevador"));
}

// =====================================================================
//  SUPERFÍCIE: depósito, ajudante e fábrica
// =====================================================================
function clicarAjudante() {
  if (aj.estado !== "parado" || noDeposito <= 0) { return; }
  aj.carga = Math.min(noDeposito, capCarrinho());
  noDeposito = noDeposito - aj.carga;
  aj.estado = "indo";
}

function moverAjudante() {
  if (aj.estado === "indo") {
    aj.x = aj.x + velAjudante();
    if (aj.x >= X_AJ_FABRICA) {
      aj.x = X_AJ_FABRICA;
      dinheiro = dinheiro + aj.carga; // fábrica: 1 minério = 1 moeda
      mostrarTexto("+" + formatar(aj.carga), 770, 60);
      aj.carga = 0;
      aj.estado = "voltando";
    }
  } else if (aj.estado === "voltando") {
    aj.x = aj.x - velAjudante();
    if (aj.x <= X_AJ_DEPOSITO) {
      aj.x = X_AJ_DEPOSITO;
      aj.estado = "parado";
    }
  }
}

function desenharSuperficie() {
  // Ajudante
  const passo = Math.floor(tempo / 10) % 2 + 1;
  let nome = "ajudante-parado.svg";
  if (aj.estado === "indo") { nome = "ajudante-andando-cheio-" + passo + ".svg"; }
  if (aj.estado === "voltando") { nome = "ajudante-andando-vazio-" + passo + ".svg"; }
  trocarImagem(ajudante, nome);
  ajudante.style.left = aj.x + "px";
  ajudante.style.transform = aj.estado === "voltando" ? "scaleX(-1)" : "none";

  // Depósito (sem limite: só mostra quanto tem guardado)
  trocarImagem(deposito, noDeposito > 0 ? "deposito-cheio.svg" : "deposito-vazio.svg");
  mudarBalao(balaoDeposito, formatar(noDeposito), noDeposito > 0 ? "amarelo" : "");

  gerenteSuperficie.classList.toggle("contratado", gerentes.superficie);
  trocarTexto(maisSuperficie.querySelector(".selo"), "Nv " + (niveis.superficie + 1));
  maisSuperficie.classList.toggle("pode", podeComprarAlgo("superficie"));

  // Vaga do próximo andar
  trocarTexto(rotuloAndar, "Novo andar · $" + formatar(precoNovoAndar()));
  maisAndar.classList.toggle("pode", podeComprarAlgo("novoAndar"));
}

// =====================================================================
//  PAINEL DE UPGRADE (um componente só para tudo)
// =====================================================================
// Linha "Gerente": contratar automatiza a estação (opção A)
// tem() diz se já está contratado; contratar() liga o gerente
function linhaGerente(tipo, i, tem, contratar) {
  return {
    icone: "gerente.svg",
    nome: function () { return "Gerente"; },
    valor: function () { return tem() ? "Trabalhando sozinho ✔" : "Deixa esta estação automática"; },
    preco: function () { return precoGerente(tipo, i); },
    max: tem,
    textoMax: "Contratado",
    comprar: contratar
  };
}

// Linhas avulsas de cada painel (gerente, mineiros, abrir andar). O nível fica num bloco à parte.
function linhasDoPainel(tipo, i) {
  if (tipo === "andar") {
    const a = andares[i];
    return [
      linhaGerente("andar", i, function () { return a.gerente; }, function () { a.gerente = true; }),
      {
        icone: "mineiro-parado.svg",
        nome: function () { return "Mineiros · " + a.mineiros + "/" + MAX_MINEIROS; },
        valor: function () {
          if (!a.gerente) { return "Precisa de gerente neste andar"; }
          return a.mineiros >= MAX_MINEIROS ? "Equipe completa" : a.mineiros + " → " + (a.mineiros + 1) + " mineiros";
        },
        preco: function () { return precoMineiro(i); },
        max: function () { return a.mineiros >= MAX_MINEIROS; },
        bloqueio: function () { return a.gerente ? "" : "🔒 Gerente"; }, // regra: mineiro extra só com gerente
        comprar: function () { a.mineiros = a.mineiros + 1; }
      }
    ];
  }
  if (tipo === "elevador") {
    return [linhaGerente("elevador", 0, function () { return gerentes.elevador; }, function () { gerentes.elevador = true; })];
  }
  if (tipo === "superficie") {
    return [linhaGerente("superficie", 0, function () { return gerentes.superficie; }, function () { gerentes.superficie = true; })];
  }
  // tipo === "novoAndar"
  return [{
    icone: "pedra-minerio.svg",
    nome: function () { return "Abrir andar " + (andares.length + 1); },
    valor: function () { return "Minério vale ×" + formatar(PISO ** andares.length); },
    preco: precoNovoAndar,
    max: function () { return andares.length >= MAX_ANDARES; },
    comprar: function () {
      adicionarAndar();
      fecharPainel();
      rolarPara(topoAndar(andares.length - 1) - 150); // mostra o andar novo
    }
  }];
}

// Números mostrados no bloco de nível (nível n). O andar ganha a "Extração total" no topo.
function statsDoPainel(tipo, i, n) {
  const lista = estacoes[tipo].stats(n, i).slice();
  if (tipo === "andar") {
    lista.unshift({ nome: "Extração total", icone: "moeda.svg", v: extracaoPorSegundo(andares[i], n), sufixo: "/s" });
  }
  return lista;
}

function tituloDoPainel(tipo, i) {
  if (tipo === "andar") { return "Andar " + (i + 1); }
  if (tipo === "elevador") { return "Elevador"; }
  if (tipo === "superficie") { return "Superfície"; }
  return "Novo andar";
}

// Texto do bloqueio de uma linha ("" = liberada). Só algumas linhas têm bloqueio.
function bloqueioDe(l) { return l.bloqueio ? l.bloqueio() : ""; }

// Uma linha pode ser comprada? (sem bloqueio, sem estar no máximo e com dinheiro)
function podeComprar(l) { return !bloqueioDe(l) && !l.max() && dinheiro >= l.preco(); }

function podeComprarAlgo(tipo, i) {
  if (linhasDoPainel(tipo, i).some(podeComprar)) { return true; }
  return tipo !== "novoAndar" && dinheiro >= precoNiveis(tipo, i, nivelDe(tipo, i), 1);
}

let linhasAbertas = null; // linhas do painel aberto (para atualizar a cada quadro)
let blocoNivel = null;    // bloco de nível do painel aberto (null no "novo andar")
let multiplicador = 1;    // 1, 10, 50 ou 0 (= Max); fica lembrado entre painéis
let painelTipo = "";

function abrirPainel(tipo, i) {
  painelLinhas.innerHTML = "";
  linhasAbertas = [];
  blocoNivel = null;
  painelTipo = tipo;

  linhasDoPainel(tipo, i).forEach(function (l) {
    const div = criar("div", "linha", painelLinhas);
    const icone = criar("img", "linha-icone", div);
    icone.src = "assets/" + l.icone;
    const info = criar("div", "linha-info", div);
    const nome = criar("div", "linha-nome", info);
    const valor = criar("div", "linha-valor", info);
    const botao = criar("button", "linha-comprar", div);
    botao.addEventListener("click", function () {
      if (!podeComprar(l)) { return; }
      dinheiro = dinheiro - l.preco(); // paga antes de comprar
      l.comprar();
    });
    linhasAbertas.push({ l: l, nome: nome, valor: valor, botao: botao });
  });

  if (tipo !== "novoAndar") { criarBlocoNivel(tipo, i); }

  painel.classList.remove("escondido");
  atualizarPainel();
}

// Bloco de nível: números da estação (atual e "+quanto sobe"), x1/x10/x50/Max e "Melhorar"
function criarBlocoNivel(tipo, i) {
  const bloco = criar("div", "bloco-nivel", painelLinhas);
  const linhasStat = statsDoPainel(tipo, i, 0).map(function (s) {
    const div = criar("div", "stat", bloco);
    const icone = criar("img", "stat-icone", div);
    icone.src = "assets/" + s.icone;
    criar("div", "stat-nome", div).textContent = s.nome;
    const valores = criar("div", "stat-valores", div);
    return { atual: criar("div", "stat-atual", valores), mais: criar("div", "stat-mais", valores) };
  });

  const rodape = criar("div", "rodape-nivel", bloco);
  const mults = criar("div", "mults", rodape);
  const botoesMult = [1, 10, 50, 0].map(function (m) {
    const b = criar("button", "mult", mults);
    b.textContent = m === 0 ? "Max" : "x" + m;
    b.addEventListener("click", function () { multiplicador = m; });
    return { m: m, b: b };
  });
  const precoEl = criar("div", "preco-nivel", rodape);
  const melhorar = criar("button", "melhorar", rodape);

  // Níveis que o botão vai comprar (Max = o que der; no mínimo 1, para mostrar o preço)
  function quantosNiveis() {
    if (multiplicador > 0) { return multiplicador; }
    return Math.max(1, niveisQueDaPraComprar(tipo, i, nivelDe(tipo, i)));
  }

  melhorar.addEventListener("click", function () {
    const k = quantosNiveis();
    const custo = precoNiveis(tipo, i, nivelDe(tipo, i), k);
    if (dinheiro < custo) { return; }
    dinheiro = dinheiro - custo;
    subirNivel(tipo, i, k);
  });

  blocoNivel = { tipo: tipo, i: i, linhasStat: linhasStat, botoesMult: botoesMult,
                 precoEl: precoEl, melhorar: melhorar, quantosNiveis: quantosNiveis };
}

function fecharPainel() {
  painel.classList.add("escondido");
  linhasAbertas = null;
  blocoNivel = null;
}

function atualizarPainel() {
  if (!linhasAbertas) { return; }
  linhasAbertas.forEach(function (r) {
    trocarTexto(r.nome, r.l.nome());
    trocarTexto(r.valor, r.l.valor());
    if (bloqueioDe(r.l)) {
      trocarTexto(r.botao, bloqueioDe(r.l));
      r.botao.disabled = true;
    } else if (r.l.max()) {
      trocarTexto(r.botao, r.l.textoMax || "Máximo");
      r.botao.disabled = true;
    } else {
      trocarTexto(r.botao, "$" + formatar(r.l.preco()));
      r.botao.disabled = dinheiro < r.l.preco();
    }
  });

  if (!blocoNivel) {
    trocarTexto(painelTitulo, tituloDoPainel(painelTipo));
    return;
  }
  const b = blocoNivel;
  const n = nivelDe(b.tipo, b.i);
  const k = b.quantosNiveis();
  trocarTexto(painelTitulo, tituloDoPainel(b.tipo, b.i) + " · Nível " + (n + 1));

  const agora = statsDoPainel(b.tipo, b.i, n);
  const depois = statsDoPainel(b.tipo, b.i, n + k);
  b.linhasStat.forEach(function (l, pos) {
    const suf = agora[pos].sufixo || "";
    trocarTexto(l.atual, formatarStat(agora[pos].v) + suf);
    trocarTexto(l.mais, "+" + formatarStat(depois[pos].v - agora[pos].v) + suf);
  });

  b.botoesMult.forEach(function (x) { x.b.classList.toggle("ativo", x.m === multiplicador); });
  const custo = precoNiveis(b.tipo, b.i, n, k);
  trocarTexto(b.precoEl, "$" + formatar(custo));
  trocarTexto(b.melhorar, "Melhorar +" + k);
  b.melhorar.disabled = dinheiro < custo;
}

// =====================================================================
//  CÂMERA (rolagem vertical)
// =====================================================================
function rolarPara(y) {
  const maximo = Math.max(0, alturaMundo() - ALTURA_TELA);
  cameraY = Math.max(0, Math.min(maximo, y));
  mundo.style.transform = "translateY(" + (-cameraY) + "px)";
  rolarCima.disabled = cameraY <= 0;
  rolarBaixo.disabled = cameraY >= maximo;
}

jogo.addEventListener("wheel", function (e) {
  if (linhasAbertas) { return; } // painel aberto: não rola
  e.preventDefault();
  rolarPara(cameraY + e.deltaY);
}, { passive: false });

rolarCima.addEventListener("click", function () { rolarPara(cameraY - ALTURA_ANDAR); });
rolarBaixo.addEventListener("click", function () { rolarPara(cameraY + ALTURA_ANDAR); });

// =====================================================================
//  GERENTES: fazem o clique da estação sozinhos
// =====================================================================
function automatizar() {
  // Andares com gerente: com a sacola cheia, manda levar até a caixa
  andares.forEach(function (a, i) {
    if (a.gerente && a.estado === "cavando" && a.sacola >= capSacola(a)) { clicarAndar(i); }
  });

  // Elevador com gerente: desce sempre que alguma caixa tem minério
  if (gerentes.elevador) { clicarElevador(); } // o próprio clique já confere se pode sair

  // Superfície com gerente: o ajudante busca sempre que o depósito tem minério
  if (gerentes.superficie) { clicarAjudante(); } // idem
}

// =====================================================================
//  LOOP E INÍCIO
// =====================================================================
function loop() {
  tempo++;
  automatizar();
  andares.forEach(moverAndar);
  moverElevador();
  moverAjudante();

  andares.forEach(desenharAndar);
  desenharElevador();
  desenharSuperficie();
  trocarTexto(textoDinheiro, formatar(dinheiro));
  atualizarPainel();

  requestAnimationFrame(loop);
}

elevador.addEventListener("click", clicarElevador);
ajudante.addEventListener("click", clicarAjudante);
maisElevador.addEventListener("click", function () { abrirPainel("elevador"); });
maisSuperficie.addEventListener("click", function () { abrirPainel("superficie"); });
maisAndar.addEventListener("click", function () { abrirPainel("novoAndar"); });
document.getElementById("painel-fechar").addEventListener("click", fecharPainel);
painel.addEventListener("click", function (e) {
  if (e.target === painel) { fecharPainel(); } // clicou fora do cartão
});

// ===================== Salvar o progresso =====================
// Fica guardado no navegador (localStorage). Salva a cada 5 s e ao fechar a aba.
// O minério que está no elevador ou no carrinho vira dinheiro no save (simplifica).
const CHAVE_SAVE = "tiozao-idle-miner-save";
let podeSalvar = true; // desligado no "Recomeçar", para não salvar de novo ao recarregar

function salvar() {
  if (!podeSalvar) { return; }
  const dados = {
    versao: 2,
    dinheiro: dinheiro + elev.carga + aj.carga,
    noDeposito: noDeposito,
    niveis: { elevador: niveis.elevador, superficie: niveis.superficie },
    gerentes: { elevador: gerentes.elevador, superficie: gerentes.superficie },
    andares: andares.map(function (a) {
      return { nivel: a.nivel, mineiros: a.mineiros, sacola: a.sacola, caixa: a.caixa, gerente: a.gerente };
    })
  };
  try { localStorage.setItem(CHAVE_SAVE, JSON.stringify(dados)); } catch (e) { /* sem acesso: segue sem salvar */ }
}

// Devolve true se carregou um save
function carregar() {
  let dados = null;
  try { dados = JSON.parse(localStorage.getItem(CHAVE_SAVE)); } catch (e) { return false; }
  if (!dados || (dados.versao !== 1 && dados.versao !== 2) || !dados.andares || dados.andares.length === 0) { return false; }
  const n = dados.niveis || {};
  const v1 = dados.versao === 1; // save antigo: níveis separados viram o nível da estação (soma)

  dinheiro = dados.dinheiro || 0;
  niveis.elevador = Math.max(0, v1 ? (n.elevador || 0) + (n.velocidade || 0) : (n.elevador || 0));
  niveis.superficie = Math.max(0, v1 ? (n.deposito || 0) + (n.carrinho || 0) : (n.superficie || 0));
  noDeposito = Math.max(0, dados.noDeposito || 0);
  gerentes.elevador = !!(dados.gerentes && dados.gerentes.elevador);
  gerentes.superficie = !!(dados.gerentes && dados.gerentes.superficie);

  dados.andares.slice(0, MAX_ANDARES).forEach(function (s) {
    adicionarAndar();
    const a = andares[andares.length - 1];
    a.mineiros = Math.max(1, Math.min(MAX_MINEIROS, s.mineiros || 1));
    a.gerente = !!s.gerente;
    if (v1) {
      const pic = s.picareta !== undefined ? s.picareta : (n.picareta || 0);
      const sac = s.nivelSacola !== undefined ? s.nivelSacola : (n.sacola || 0);
      a.nivel = Math.max(0, pic + sac);
    } else {
      a.nivel = Math.max(0, s.nivel || 0);
      a.caixa = Math.max(0, s.caixa || 0);
    }
    a.sacola = Math.min(s.sacola || 0, capSacola(a));
  });
  return true;
}

function recomecar() {
  if (!confirm("Apagar todo o progresso e começar do zero?")) { return; }
  podeSalvar = false;
  try { localStorage.removeItem(CHAVE_SAVE); } catch (e) { /* nada */ }
  location.reload();
}

document.getElementById("recomecar").addEventListener("click", recomecar);
setInterval(salvar, 5000);
window.addEventListener("beforeunload", salvar);

if (!carregar()) {
  adicionarAndar(); // jogo novo: começa com o andar 1
}
rolarPara(0);
loop();
