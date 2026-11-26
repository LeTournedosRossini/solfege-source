// Aide commune aux tests des jeux : après une mauvaise réponse, la correction attend un clic sur « OK » ; ces tests répondent au hasard, donc on clique OK tout seul après `delai` ms
// (assez long pour lire le texte de correction dans le test).
export async function autoOk(page, delai = 450) {
  await page.addInitScript((d) => {
    new MutationObserver(() => { document.querySelectorAll('button[id$="-ok"]').forEach((b) => { if (!b.dataset.auto) { b.dataset.auto = '1'; setTimeout(() => b.click(), d); } }); })
      .observe(document, { childList: true, subtree: true });
  }, delai);
}
