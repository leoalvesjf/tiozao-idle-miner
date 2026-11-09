// =====================================================================
//  Tiozão Idle Miner: game.js
//  Cadeia: mineiros → elevador (para em cada andar) → depósito → ajudante → fábrica → $
//  Regra: um clique = uma tarefa completa (a volta faz parte). Nada é automático sem gerente.
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

const RITMO_GERENTE = 30;        // gerente de andar: um golpe a cada 30 quadros (~0,5 s)

function topoAndar(i) { return ALTURA_SUPERFICIE + i * ALTURA_ANDAR; }
function yCabineNoAndar(i) { return topoAndar(i) + 114; } // piso da cabine no chão do andar

// ===== Upgrades =====
// Picareta e sacola (de cada andar): valor sobe somando, preço ×1,5.
// Regra da proporção (elevador, depósito, carrinho, velocidade): valor e preço sobem no mesmo ritmo (fator).
const upgrades = {
  picareta: { nome: "Picareta", nivel: 0, precoBase: 10, valor: function (n) { return n + 1; } },
  sacola:   { nome: "Sacola",   nivel: 0, precoBase: 15, valor: function (n) { return 10 + 5 * n; } },
  elevador: { nome: "Elevador", nivel: 0, precoBase: 20, fator: 1.4, valor: function (n) { return Math.round(20 * 1.4 ** n); } },
  velocidade: { nome: "Velocidade", nivel: 0, precoBase: 25, fator: 1.4, valor: function (n) { return Math.round(100 * 1.1 ** n); } }, // em %
  deposito: { nome: "Depósito", nivel: 0, precoBase: 20, fator: 1.4, valor: function (n) { return Math.round(30 * 1.4 ** n); } },
  carrinho: { nome: "Carrinho", nivel: 0, precoBase: 15, fator: 1.4, valor: function (n) { return Math.round(10 * 1.4 ** n); } }
};

function valorAtual(id) { return upgrades[id].valor(upgrades[id].nivel); }
function preco(id) { return Math.floor(upgrades[id].precoBase * (upgrades[id].fator || 1.5) ** upgrades[id].nivel); }
// Velocidade do elevador em pixels por quadro (100% = VEL_ELEVADOR)
function velElevador() { return VEL_ELEVADOR * valorAtual("velocidade") / 100; }

// Contratar mineiro no andar i: 50 × 2^(mineiros-1) × 5^i
function precoMineiro(i) { return Math.floor(50 * 2 ** (andares[i].mineiros - 1) * 5 ** i); }
// Abrir o próximo andar: 100, 1.000, 10.000...
function precoNovoAndar() { return 100 * 10 ** (andares.length - 1); }

// Gerentes (opção A: só automatizam). Superfície 100, elevador 150, andar N: 75 × 5^(N-1)
function precoGerente(tipo, i) {
  if (tipo === "superficie") { return 100; }
  if (tipo === "elevador") { return 150; }
  return 75 * 5 ** i;
}

// ===== Estado do jogo =====
let dinheiro = 0;
let noDeposito = 0;
let tempo = 0;          // contador de quadros (anima as caminhadas)
let cameraY = 0;        // quanto o mundo está rolado para baixo
const andares = [];     // cada andar: { mineiros, sacola, estado, x, golpe, imgs, balao, mais }
const elev = { y: Y_TOPO_ELEVADOR, estado: "topo", carga: 0, alvo: 0, espera: 0 };
// estados do elevador: "topo" (parado em cima), "descendo", "parado" (num andar), "subindo"
const aj = { x: X_AJ_DEPOSITO, estado: "parado", carga: 0 };
const gerentes = { elevador: false, superficie: false }; // os de andar ficam em cada andar

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
  const classe = "balao" + (cor ? " " + cor : "");
  if (el.className !== classe) { el.className = classe; }
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
// Picareta e sacola são de cada andar (a.niveis); a tabela "upgrades" só dá a fórmula do valor
function valorDoAndar(a, id) { return upgrades[id].valor(a.niveis[id]); }
// Preço no andar i: base × 1,5^nível × 5^i (mais fundo = mais caro, como os mineiros)
function precoDoAndar(a, i, id) { return Math.floor(upgrades[id].precoBase * 1.5 ** a.niveis[id] * 5 ** i); }

function capSacola(a) { return valorDoAndar(a, "sacola") * a.mineiros; }

// Quanto entra por clique no andar i: picareta × mineiros × (i+1). Mais fundo = minério vale mais
function ganhoPorClique(i) { return valorDoAndar(andares[i], "picareta") * andares[i].mineiros * (i + 1); }

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

  const balao = criar("div", "balao", div);

  const imgGerente = criar("img", "gerente", div); // aparece quando contratado
  imgGerente.src = "assets/gerente.svg";

  const mais = criar("button", "botao-mais", div);
  mais.textContent = "+";
  criar("span", "selo", mais);
  mais.addEventListener("click", function () { abrirPainel("andar", i); });

  andares.push({ mineiros: 1, sacola: 0, estado: "cavando", x: X_PAREDE, golpe: 0,
                 gerente: false, relogio: 0, niveis: { picareta: 0, sacola: 0 }, // gerente: automatiza o andar e libera mineiros extras
                 imgs: imgs, balao: balao, mais: mais, imgGerente: imgGerente });
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

// Clique nos mineiros de um andar: cava (todos juntos) ou, com a sacola cheia, manda levar
function clicarAndar(i) {
  const a = andares[i];
  if (a.estado !== "cavando") { return; }

  const cap = capSacola(a);
  if (a.sacola >= cap) {
    a.estado = "indo";
    return;
  }

  const ganho = Math.min(ganhoPorClique(i), cap - a.sacola); // o excesso é perdido
  a.sacola = a.sacola + ganho;
  a.golpe = 9; // pose "trabalhando" por 9 quadros (~0,15 s)
  mostrarPedra(740, topoAndar(i) + 170);
  mostrarTexto("+" + formatar(ganho), 760, topoAndar(i) + 110);
}

function moverAndar(a) {
  if (a.golpe > 0) { a.golpe--; }

  if (a.estado === "indo") {
    a.x = a.x - VEL_MINEIRO;
    if (a.x <= X_POCO) {
      a.x = X_POCO;
      a.estado = "esperando"; // só despeja quando o elevador parar neste andar
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
    } else if (a.estado === "esperando") {
      nome = "mineiro-andando-1.svg";
      espelhado = true;
    } else if (a.estado === "voltando") {
      nome = "mineiro-andando-vazio-" + passo + ".svg";
    }
    trocarImagem(img, nome);
    img.style.left = (a.x + OFFSET_MINEIRO[k]) + "px";
    img.style.transform = espelhado ? "scaleX(-1)" : "none";
  }

  // Balão do andar
  const cap = capSacola(a);
  if (a.estado === "esperando") {
    mudarBalao(a.balao, "Esperando " + formatar(a.sacola), "laranja");
  } else if (a.estado === "cavando" && a.sacola >= cap) {
    mudarBalao(a.balao, "Levar!", "amarelo");
  } else {
    mudarBalao(a.balao, formatar(a.sacola) + "/" + formatar(cap), "");
  }
  a.balao.style.left = (a.x + 75 + OFFSET_MINEIRO[a.mineiros - 1] / 2) + "px";

  a.imgGerente.classList.toggle("contratado", a.gerente);

  // Botão "+": selo com a equipe e pulsa se dá para comprar algo
  trocarTexto(a.mais.querySelector(".selo"), a.mineiros + "/" + MAX_MINEIROS);
  a.mais.classList.toggle("pode", podeComprarAlgo("andar", i));
}

// =====================================================================
//  ELEVADOR: desce parando em cada andar, sobe e despeja no depósito
// =====================================================================
// Primeiro andar (a partir de "inicio") com mineiros esperando com minério; -1 se nenhum
function proximoAndarComMinerio(inicio) {
  for (let j = inicio; j < andares.length; j++) {
    if (andares[j].estado === "esperando" && andares[j].sacola > 0) { return j; }
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
  const cap = valorAtual("elevador");

  if (elev.estado === "descendo") {
    elev.y = elev.y + velElevador();
    const yAlvo = yCabineNoAndar(elev.alvo);
    if (elev.y >= yAlvo) {
      elev.y = yAlvo;
      elev.estado = "parado";
      elev.espera = PARADA_ANDAR;
    }

  } else if (elev.estado === "parado") {
    // Recolhe de quem está esperando neste andar (até encher a cabine)
    const a = andares[elev.alvo];
    if (a.estado === "esperando" && elev.carga < cap) {
      const pega = Math.min(a.sacola, cap - elev.carga);
      elev.carga = elev.carga + pega;
      a.sacola = a.sacola - pega;
      if (a.sacola <= 0) { a.estado = "voltando"; }
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
    // Despeja no depósito o que couber; o resto espera na cabine
    const espaco = valorAtual("deposito") - noDeposito;
    const despeja = Math.min(elev.carga, espaco);
    if (despeja > 0) {
      noDeposito = noDeposito + despeja;
      elev.carga = elev.carga - despeja;
    }
  }
}

function desenharElevador() {
  const cap = valorAtual("elevador");
  trocarImagem(elevador, elev.carga > 0 ? "elevador-cheio.svg" : "elevador-vazio.svg");
  elevador.style.top = elev.y + "px";
  cabo.style.height = (elev.y - 116) + "px"; // da roldana até a cabine

  const travado = elev.estado === "topo" && elev.carga > 0; // depósito lotado
  if (travado) {
    mudarBalao(balaoElevador, "Depósito cheio!", "vermelho");
  } else {
    mudarBalao(balaoElevador, formatar(elev.carga) + "/" + formatar(cap), elev.carga > 0 ? "amarelo" : "");
  }
  balaoElevador.style.top = (elev.y - 30) + "px";
  elevador.style.cursor = (elev.estado === "topo" && elev.carga === 0) ? "pointer" : "default";

  gerenteElevador.classList.toggle("contratado", gerentes.elevador);
  trocarTexto(maisElevador.querySelector(".selo"), "Nv " + upgrades.elevador.nivel);
  maisElevador.classList.toggle("pode", podeComprarAlgo("elevador"));
}

// =====================================================================
//  SUPERFÍCIE: depósito, ajudante e fábrica
// =====================================================================
function clicarAjudante() {
  if (aj.estado !== "parado" || noDeposito <= 0) { return; }
  aj.carga = Math.min(noDeposito, valorAtual("carrinho"));
  noDeposito = noDeposito - aj.carga;
  aj.estado = "indo";
}

function moverAjudante() {
  if (aj.estado === "indo") {
    aj.x = aj.x + VEL_AJUDANTE;
    if (aj.x >= X_AJ_FABRICA) {
      aj.x = X_AJ_FABRICA;
      dinheiro = dinheiro + aj.carga; // fábrica: 1 minério = 1 moeda
      mostrarTexto("+" + formatar(aj.carga), 770, 60);
      aj.carga = 0;
      aj.estado = "voltando";
    }
  } else if (aj.estado === "voltando") {
    aj.x = aj.x - VEL_AJUDANTE;
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

  // Depósito
  const capDep = valorAtual("deposito");
  trocarImagem(deposito, noDeposito > 0 ? "deposito-cheio.svg" : "deposito-vazio.svg");
  if (noDeposito >= capDep) {
    mudarBalao(balaoDeposito, "Cheio!", "vermelho");
  } else {
    mudarBalao(balaoDeposito, formatar(noDeposito) + "/" + formatar(capDep), noDeposito > 0 ? "amarelo" : "");
  }

  gerenteSuperficie.classList.toggle("contratado", gerentes.superficie);
  trocarTexto(maisSuperficie.querySelector(".selo"), "Nv " + upgrades.carrinho.nivel);
  maisSuperficie.classList.toggle("pode", podeComprarAlgo("superficie"));

  // Vaga do próximo andar
  trocarTexto(rotuloAndar, "Novo andar · $" + formatar(precoNovoAndar()));
  maisAndar.classList.toggle("pode", podeComprarAlgo("novoAndar"));
}

// =====================================================================
//  PAINEL DE UPGRADE (um componente só para tudo)
// =====================================================================
// Linha de upgrade comum (picareta, sacola, elevador, depósito, carrinho)
function linhaUpgrade(id, icone, sufixo) {
  const u = upgrades[id];
  return {
    icone: icone,
    nome: function () { return u.nome + " · Nv " + u.nivel; },
    valor: function () { return formatar(valorAtual(id)) + " → " + formatar(u.valor(u.nivel + 1)) + sufixo; },
    preco: function () { return preco(id); },
    max: function () { return false; },
    comprar: function () { u.nivel = u.nivel + 1; }
  };
}

// Linha de upgrade de um andar (picareta e sacola, níveis próprios do andar)
function linhaUpgradeAndar(a, i, id, icone, sufixo) {
  const u = upgrades[id];
  return {
    icone: icone,
    nome: function () { return u.nome + " · Nv " + a.niveis[id]; },
    valor: function () { return formatar(valorDoAndar(a, id)) + " → " + formatar(u.valor(a.niveis[id] + 1)) + sufixo; },
    preco: function () { return precoDoAndar(a, i, id); },
    max: function () { return false; },
    comprar: function () { a.niveis[id] = a.niveis[id] + 1; }
  };
}

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

// O que aparece em cada painel
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
      },
      linhaUpgradeAndar(a, i, "picareta", "pedra-minerio.svg", " por golpe"),
      linhaUpgradeAndar(a, i, "sacola", "sacola.svg", " por mineiro")
    ];
  }
  if (tipo === "elevador") {
    return [
      linhaGerente("elevador", 0, function () { return gerentes.elevador; }, function () { gerentes.elevador = true; }),
      linhaUpgrade("elevador", "elevador-vazio.svg", " por viagem"),
      linhaUpgrade("velocidade", "elevador-cheio.svg", "% de velocidade")
    ];
  }
  if (tipo === "superficie") {
    return [
      linhaGerente("superficie", 0, function () { return gerentes.superficie; }, function () { gerentes.superficie = true; }),
      linhaUpgrade("deposito", "deposito-vazio.svg", " de espaço"),
      linhaUpgrade("carrinho", "ajudante-parado.svg", " por viagem")
    ];
  }
  // tipo === "novoAndar"
  return [{
    icone: "pedra-minerio.svg",
    nome: function () { return "Abrir andar " + (andares.length + 1); },
    valor: function () { return "Minério vale ×" + (andares.length + 1); },
    preco: precoNovoAndar,
    max: function () { return andares.length >= MAX_ANDARES; },
    comprar: function () {
      adicionarAndar();
      fecharPainel();
      rolarPara(topoAndar(andares.length - 1) - 150); // mostra o andar novo
    }
  }];
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
  return linhasDoPainel(tipo, i).some(podeComprar);
}

let linhasAbertas = null; // linhas do painel aberto (para atualizar a cada quadro)

function abrirPainel(tipo, i) {
  painelTitulo.textContent = tituloDoPainel(tipo, i);
  painelLinhas.innerHTML = "";
  linhasAbertas = [];

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
      dinheiro = dinheiro - l.preco(); // paga antes de subir o nível
      l.comprar();
    });
    linhasAbertas.push({ l: l, nome: nome, valor: valor, botao: botao });
  });

  painel.classList.remove("escondido");
  atualizarPainel();
}

function fecharPainel() {
  painel.classList.add("escondido");
  linhasAbertas = null;
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
  // Andares com gerente: um golpe a cada RITMO_GERENTE quadros; com a sacola cheia, manda levar
  andares.forEach(function (a, i) {
    if (!a.gerente || a.estado !== "cavando") { return; }
    a.relogio++;
    if (a.sacola >= capSacola(a) || a.relogio >= RITMO_GERENTE) {
      a.relogio = 0;
      clicarAndar(i);
    }
  });

  // Elevador com gerente: desce sempre que algum andar tem minério esperando
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
  const niveis = {};
  for (const id in upgrades) { niveis[id] = upgrades[id].nivel; }
  const dados = {
    versao: 1,
    dinheiro: dinheiro + elev.carga + aj.carga,
    noDeposito: noDeposito,
    niveis: niveis,
    gerentes: { elevador: gerentes.elevador, superficie: gerentes.superficie },
    andares: andares.map(function (a) {
      return { mineiros: a.mineiros, sacola: a.sacola, gerente: a.gerente,
               picareta: a.niveis.picareta, nivelSacola: a.niveis.sacola };
    })
  };
  try { localStorage.setItem(CHAVE_SAVE, JSON.stringify(dados)); } catch (e) { /* sem acesso: segue sem salvar */ }
}

// Devolve true se carregou um save
function carregar() {
  let dados = null;
  try { dados = JSON.parse(localStorage.getItem(CHAVE_SAVE)); } catch (e) { return false; }
  if (!dados || dados.versao !== 1 || !dados.andares || dados.andares.length === 0) { return false; }

  dinheiro = dados.dinheiro || 0;
  for (const id in upgrades) {
    if (dados.niveis && dados.niveis[id] >= 0) { upgrades[id].nivel = dados.niveis[id]; }
  }
  noDeposito = Math.min(dados.noDeposito || 0, valorAtual("deposito"));
  gerentes.elevador = !!(dados.gerentes && dados.gerentes.elevador);
  gerentes.superficie = !!(dados.gerentes && dados.gerentes.superficie);

  dados.andares.slice(0, MAX_ANDARES).forEach(function (s) {
    adicionarAndar();
    const a = andares[andares.length - 1];
    a.mineiros = Math.max(1, Math.min(MAX_MINEIROS, s.mineiros || 1));
    a.gerente = !!s.gerente;
    // Save antigo (níveis globais): cada andar herda o nível que a mina tinha
    const antigo = dados.niveis || {};
    a.niveis.picareta = Math.max(0, s.picareta !== undefined ? s.picareta : (antigo.picareta || 0));
    a.niveis.sacola = Math.max(0, s.nivelSacola !== undefined ? s.nivelSacola : (antigo.sacola || 0));
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
