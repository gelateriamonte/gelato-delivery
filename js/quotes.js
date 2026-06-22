// ============================================================
// Citazione/battuta casuale sul gelato per la thank-you page.
// Pesca un indice random a fine ordine; resta lo stesso al cambio
// lingua (ri-renderizza IT/EN via I18N.lang()). Caricare DOPO i18n.js.
// ============================================================
(function () {
  var QUOTES = [
    { it: "Non puoi rendere tutti felici, non sei una vaschetta di gelato.", en: "You can't please everyone — you're not a tub of gelato." },
    { it: "Il gelato è squisito, fortuna che non è illegale.", en: "Ice cream is exquisite. What a pity it isn't illegal." },
    { it: "Non puoi compitare la felicità, ma puoi mangiare un gelato, che è praticamente la stessa cosa.", en: "You can't spell happiness, but you can eat gelato — which is basically the same thing." },
    { it: "L'amore è quando prendi un gelato e sei in pace con il mondo.", en: "Love is when you grab a gelato and you're at peace with the world." },
    { it: "Il gelato non è un dolce. Il gelato non è un dessert. Il gelato non è un alimento. È il concetto di felicità.", en: "Ice cream isn't a sweet. Ice cream isn't a dessert. Ice cream isn't food. It's the very idea of happiness." },
    { it: "Sei come il gelato: dolce e un po' salato? No, due palle.", en: "You're like ice cream: sweet and a little salty? Nope — two scoops of boring." },
    { it: "Il gelato d'estate dovrebbe passarlo la mutua.", en: "Summer ice cream should be covered by your health plan." },
    { it: "Ci sono solo due cose per cui vale la pena vivere: una è un buon gelato, l'altra è un gelato ancora migliore.", en: "There are only two things worth living for: good gelato, and even better gelato." },
    { it: "Chi ti ama sa qual è il tuo gelato preferito.", en: "Whoever loves you knows your favorite flavor." },
    { it: "L'amore è comprare il gusto di gelato preferito di tua moglie. Anche quando lei non c'è.", en: "Love is buying your wife's favorite flavor. Even when she's not there." },
    { it: "Quando tutti ti hanno deluso… hai ancora il gelato.", en: "When everyone's let you down… you've still got ice cream." },
    { it: "La bellezza salverà il mondo, ma anche il gelato fa la sua parte.", en: "Beauty will save the world — but ice cream does its part too." },
    { it: "Essere felici a volte costa solo mezzo chilo di gelato.", en: "Sometimes happiness costs no more than a tub of ice cream." },
    { it: "È più difficile odiare qualcuno quando gli piace il tuo stesso gusto di gelato.", en: "It's harder to hate someone who loves the same flavor you do." },
    { it: "Ci sono problemi che solo un caffè e un gelato possono risolvere.", en: "Some problems only a coffee and an ice cream can solve." },
    { it: "Il gelato è felicità condensata.", en: "Ice cream is happiness, condensed." },
    { it: "Dubito che ci sia al mondo una sorpresa più sconvolgente della prima volta che assaggi un gelato.", en: "I doubt whether the world holds for anyone a more soul-stirring surprise than the first adventure with ice-cream.", by: "Heywood Broun" },
    { it: "Una persona che passeggia mangiando il gelato, tra il sole e gli alberi, è una felicità che sta fortificando se stessa.", en: "Someone strolling with an ice cream, among sun and trees, is happiness fortifying itself." },
    { it: "Uscire dalla gelateria con una coppetta di «vorrei» lievi, mentre l'estate scorre vicino.", en: "Walking out of the gelateria with a little cup of soft 'what-ifs', while summer drifts past." },
    { it: "Fra uomo e gelato fu amore al primo gusto.", en: "Between a man and gelato, it was love at first taste." },
    { it: "Quando finisce l'estate, mi pento di tutti i gusti di gelato che non ho mangiato.", en: "When summer ends, I regret every flavor I never tried." },
    { it: "Se sentite un vuoto dentro, riempitelo con i gusti pistacchio e stracciatella.", en: "If you feel an emptiness inside, fill it with pistachio and stracciatella." },
    { it: "L'ennesimo sogno che si scioglie tra le dita come un gelato, chissà a che gusto era.", en: "One more dream melting through my fingers like ice cream — who knows what flavor it was." },
    { it: "Le cose che torniamo a fare con la primavera: il primo gelato di stagione, camminare a piedi scalzi, la brezza sul collo, ridere a crepapelle in un prato.", en: "The things we return to in spring: the season's first ice cream, bare feet, the breeze on your neck, laughing your head off in a meadow." },
    { it: "Certe sere mancano un gelato al pistacchio, il profumo di glicine e uno di quei tramonti infiniti sul mare.", en: "Some evenings are missing a pistachio gelato, the scent of wisteria, and one of those endless sunsets over the sea." },
    { it: "Ho mangiato un gelato nel parco, ed ora sono tutto sporco d'infanzia lontana.", en: "I ate an ice cream in the park, and now I'm all smudged with a faraway childhood." },
    { it: "Voglio l'amore sempre tra le mani come un gelato al limone mangiato in riva al mare in un pomeriggio di maggio.", en: "I want love always in my hands, like a lemon ice cream by the sea on a May afternoon." },
    { it: "Il mio amore per il gelato è nato in tenera età, e non è mai più finito.", en: "My love for ice cream emerged at an early age — and has never left!", by: "Ginger Rogers" },
    { it: "Quando prendo un gelato — templi, chiese, obelischi, rupi — è una pittoresca geografia che prima ammiro, per poi convertirne i monumenti di lampone e vaniglia nella mia gola.", en: "Temples, churches, obelisks, rocks — a picturesque geography I admire first, then melt its raspberry and vanilla monuments down into the coolness of my throat.", by: "Marcel Proust" },
    { it: "Due cose in questo mondo meritano il primo onore: il sorbetto gelato e il caldo amore.", en: "Two things in this world deserve first honour: frozen sherbet and warm love.", by: "Carlo Goldoni" },
    { it: "Il gelato è la felicità fatta cibo.", en: "Ice cream is happiness made edible." }
  ];

  var el = document.getElementById("grazieQuote");
  if (!el) return;
  var i = Math.floor(Math.random() * QUOTES.length);

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function render() {
    var q = QUOTES[i];
    var lang = (window.I18N && I18N.lang && I18N.lang() === "en") ? "en" : "it";
    var text = q[lang] || q.it;
    var html = '<blockquote class="quote-text">' + esc(text) + "</blockquote>";
    if (q.by) html += '<figcaption class="quote-by">— ' + esc(q.by) + "</figcaption>";
    el.innerHTML = html;
    el.hidden = false;
  }

  render();
  if (window.I18N && I18N.onLangChange) I18N.onLangChange(render);
})();
