// ===== Estado do jogo =====
let dinheiro = 0;
let nivel = 0; // nível da picareta

// ===== Peças da tela =====
const mineiro = document.getElementById("mineiro");
const textoDinheiro = document.getElementById("dinheiro");
const botaoUpgrade = document.getElementById("botao-upgrade");

// ===== Fórmulas (ver plano) =====
function ganhoPorClique() {
  return nivel + 1;
}

function precoUpgrade() {
  return Math.floor(10 * 1.5 ** nivel);
}

// ===== Atualiza o que aparece na tela =====
function atualizarTela() {
  textoDinheiro.textContent = dinheiro;
  botaoUpgrade.textContent = "Picareta Nv " + nivel + ": custa " + precoUpgrade();
  botaoUpgrade.disabled = dinheiro < precoUpgrade();
}

// ===== Comprar upgrade da picareta =====
function comprarUpgrade() {
  if (dinheiro < precoUpgrade()) {
    return; // sem dinheiro, não faz nada
  }
  dinheiro = dinheiro - precoUpgrade();
  nivel = nivel + 1;
  atualizarTela();
}

botaoUpgrade.addEventListener("click", comprarUpgrade);

// ===== Efeitos do clique: pedra e "+N" =====
// Cada clique cria peças novas que somem sozinhas depois da animação.
function mostrarEfeitos(ganho) {
  const jogo = document.getElementById("jogo");

  const pedra = document.createElement("img");
  pedra.src = "assets/pedra-minerio.svg";
  pedra.className = "pedra";
  jogo.appendChild(pedra);
  setTimeout(function () { pedra.remove(); }, 600);

  const texto = document.createElement("div");
  texto.textContent = "+" + ganho;
  texto.className = "ganho";
  jogo.appendChild(texto);
  setTimeout(function () { texto.remove(); }, 800);
}

// ===== Clique no mineiro =====
function clicarMineiro() {
  // Ganha dinheiro
  const ganho = ganhoPorClique();
  dinheiro = dinheiro + ganho;
  atualizarTela();
  mostrarEfeitos(ganho);

  // Troca para a pose "trabalhando"...
  mineiro.src = "assets/mineiro-trabalhando.svg";

  // ...e volta para "parado" depois de 0,15 segundo
  setTimeout(function () {
    mineiro.src = "assets/mineiro-parado.svg";
  }, 150);
}

mineiro.addEventListener("click", clicarMineiro);
atualizarTela();
