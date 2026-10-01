/**
 * More free actions ("Kunststücke"): one table for the scripted narrator (keywords → roll → effect),
 * the AI (named effects in its toolbox) and the rules (src/tv/game.ts applyStunt).
 * None of them is a button on the phone – they are found by what a player writes or says.
 */
import type { SkillId } from "../shared/rules";

export type StuntTarget = "enemy" | "hero" | "person" | "thing" | "self";
export type StuntSetback = "exposed" | "fall" | "hurt" | "enrage" | "fumble";

/**
 * What can happen by accident (ups!) – rarely on a success, more often when it only just worked.
 * Mostly mishaps, sometimes a lucky find.
 */
export type Mishap =
  | "wake" // the noise wakes sleeping or watching foes
  | "fire" // sparks: the floor next to the hero catches fire
  | "slip" // the hero slips and falls
  | "slip_friend" // a friend nearby falls too
  | "hurt" // the hero hurts themself a little
  | "hurt_friend" // a friend nearby gets hit (never knocked out)
  | "enrage" // another foe gets angry
  | "offend" // the person takes it the wrong way
  | "drop" // coins fall out of the pocket
  | "dark" // the light goes out
  | "scare_friend" // a friend gets a fright
  | "flee_npc" // the person runs off
  | "trap" // a hidden trap snaps
  | "lucky_find" // by chance: a few coins
  | "reveal"; // by chance: a hidden part becomes visible

export interface Stunt {
  id: string;
  /** Name in the AI's toolbox. */
  name: string;
  combat: boolean | "both";
  /** No skill: it simply happens (costs the action or, in a fight, the bonus action). */
  skill?: SkillId;
  dc?: number;
  words: RegExp;
  target: StuntTarget;
  /** What happens on success (shown on the phone before rolling). */
  plan: string;
  /** For the AI: what the effect does. */
  help: string;
  setback?: StuntSetback;
  /** What may happen by accident. */
  oops?: Mishap[];
}

export const STUNTS: Stunt[] = [
  // ⚔️ Fighting tricks
  { id: "feint", name: "finte", combat: true, skill: "deception", dc: 12, words: /\bfinte\b|täusch\w* (links|rechts|an)|tu so,? als ob ich (links|rechts)/, target: "self", plan: "Dein nächster Angriff hat Vorteil", help: "Finte: der Held selbst hat Vorteil auf seinen nächsten Angriff", setback: "exposed", oops: ["slip"] },
  { id: "shield_bash", name: "schildstoss", combat: true, skill: "athletics", dc: 13, words: /mit dem schild (ramm|stoß|stoss|schlag|hau)|schild ?(ramm|stoß|stoss)|ramm\w* .*mit (meinem|dem) schild/, target: "enemy", plan: "Gegner fliegt zurück und liegt am Boden", help: "Rammstoß mit dem Schild (nur mit Schild): Gegner 1 Feld zurück und am Boden", setback: "fall", oops: ["slip"] },
  { id: "sweep", name: "beinfeger", combat: true, skill: "athletics", dc: 12, words: /beine weg|beinfeger|feg\w* .*(beine|füße)|säbel\w* .*beine/, target: "enemy", plan: "Gegner liegt am Boden", help: "Beinfeger (mit Stab/Speer auch auf Abstand): Gegner am Boden", setback: "fall", oops: ["slip_friend"] },
  { id: "grapple", name: "festhalten", combat: true, skill: "athletics", dc: 13, words: /halt\w* (ihn|sie|es|den|die) fest|festhalt|umklammer|klammer\w* mich an|in den schwitzkasten|würgegriff/, target: "enemy", plan: "Gegner festgehalten: alle haben Vorteil gegen ihn", help: "festhalten: Gegner (kein Anführer) kann sich 1 Runde nicht bewegen, Angriffe auf ihn haben Vorteil", setback: "exposed", oops: ["slip", "hurt"] },
  { id: "protect", name: "beschuetzen", combat: true, words: /stell\w* mich (schützend )?vor|beschütz|schütz\w* (ihn|sie|brunhild|\w+) mit meinem|deck\w* (ihn|sie) mit meinem körper|halte? den kopf hin für/, target: "hero", plan: "", help: "beschützen (ohne Probe): ein Held bekommt +2 RK, solange der Beschützer neben ihm steht (1 Runde)" },
  { id: "battle_cry", name: "kampfschrei", combat: true, skill: "intimidation", dc: 13, words: /kampfschrei|schlachtruf|kriegsschrei|kriegsgeheul|stoß\w* einen schrei aus/, target: "self", plan: "Kleine Gegner bekommen Angst", help: "Kampfschrei: kleine Gegner in der Nähe haben 1 Runde Angst (Nachteil)", setback: "exposed", oops: ["wake", "scare_friend"] },
  { id: "taunt", name: "provozieren", combat: true, skill: "deception", dc: 10, words: /provozier|komm her,? du|feigling|traust dich (wohl )?nicht|hier bin ich,? du|greif mich an/, target: "enemy", plan: "Der Gegner greift nur noch dich an", help: "provozieren: der Gegner greift in seinem nächsten Zug nur diesen Helden an (schützt Schwächere)", setback: "enrage", oops: ["enrage"] },
  { id: "grab_weapon", name: "waffe_schnappen", combat: true, skill: "sleight-of-hand", dc: 13, words: /schnapp\w* mir (sein|ihr|die|das|den)|nehm\w* (ihm|ihr) (die|das|den) (waffe|schwert|keule|dolch|axt) (weg|ab)|reiß\w* (ihm|ihr) .*(waffe|schwert) aus/, target: "enemy", plan: "Seine Waffe ist jetzt deine", help: "Waffe schnappen: Gegner entwaffnet (Nachteil), der Held hat Vorteil auf den nächsten Angriff", setback: "exposed", oops: ["hurt"] },
  { id: "slide", name: "durchrutschen", combat: true, skill: "acrobatics", dc: 12, words: /rutsch\w* (unter|zwischen|durch)|unter .* (durch|hindurch)|zwischen (seinen|ihren) beinen|rolle? mich (weg|ab|vorbei)/, target: "self", plan: "Du kommst ohne Gelegenheitsangriff vorbei", help: "durchrutschen: der Held bewegt sich in diesem Zug ohne Gelegenheitsangriffe", setback: "fall", oops: ["slip", "drop"] },
  { id: "tap_barrel", name: "fass_anstechen", combat: "both", skill: "sleight-of-hand", dc: 10, words: /(stech|bohr)\w* .*(ins|in das) (bier|wein)?fass|loch ins fass|fass an(stech|zapf)|zapf\w* (das )?(bier|wein)?fass an/, target: "enemy", plan: "Rutschiger Boden um den Gegner", help: "Fass anstechen: rutschiger, matschiger Boden um ein Ziel", setback: "hurt", oops: ["slip_friend"] },
  { id: "rug_pull", name: "teppich_ziehen", combat: true, skill: "athletics", dc: 13, words: /teppich (weg|unter)|zieh\w* .*teppich|tischdecke (weg|unter)/, target: "enemy", plan: "Gegner und seine Nachbarn liegen am Boden", help: "Teppich wegziehen: ein Gegner und Gegner direkt neben ihm (keine Anführer) liegen am Boden", setback: "fall", oops: ["slip_friend"] },
  // 🧙 Magic used creatively
  { id: "redirect", name: "zauber_umlenken", combat: true, skill: "arcana", dc: 13, words: /lenk\w* (den|die|das|meinen|meine) .*(zauber|strahl|blitz|feuer).* auf|zauber .* auf (das|den) (fass|öl|kronleuchter)/, target: "enemy", plan: "Der Zauber trifft das Fass – Explosion", help: "Zauber umlenken (nur Zauberkundige): ein Zauber zündet etwas an, 2W6 Schaden für das Ziel", setback: "hurt", oops: ["fire", "hurt_friend"] },
  { id: "light_blind", name: "licht_blenden", combat: true, skill: "sleight-of-hand", dc: 11, words: /(licht|fackel|lampe|laterne|spiegel)\w* .*(in die augen|ins gesicht)|blend\w* (ihn|sie|den|die) mit (dem |meinem )?(licht|spiegel|fackel)/, target: "enemy", plan: "Gegner ist eine Runde geblendet", help: "mit Licht blenden: Gegner (kein Anführer) 1 Runde blind", setback: "fumble", oops: ["dark"] },
  { id: "frost_grip", name: "festfrieren", combat: true, skill: "arcana", dc: 13, words: /friere? .*(fest|ein)|festfrier|hand .*(am|an den) griff .*frier|waffe .*einfrier/, target: "enemy", plan: "Seine Hand friert an der Waffe fest", help: "festfrieren (Kältezauber): Gegner kann seine Waffe kaum nutzen (Nachteil bis Kampfende)", setback: "fumble", oops: ["slip"] },
  { id: "illusion", name: "illusion", combat: true, skill: "arcana", dc: 12, words: /illusion|trugbild|blendwerk|lass\w* .*(geräusch|stimme) hinter|zauber\w* .*geräusch/, target: "self", plan: "Die Gegner drehen sich um – Vorteil für alle", help: "Illusion: bis zu drei Gegner sind abgelenkt (Vorteil gegen sie)", setback: "exposed", oops: ["scare_friend"] },
  { id: "mage_hand", name: "magische_hand", combat: false, skill: "arcana", dc: 10, words: /magische hand|lass\w* .*(zu mir )?schweben|zu mir (schweben|fliegen)|telekines/, target: "self", plan: "Du holst etwas aus der Ferne zu dir", help: "magische Hand: etwas Liegendes (Gold, Trank) in bis zu 6 Feldern kommt zum Helden", oops: ["wake"] },
  { id: "charge", name: "kraft_sammeln", combat: true, words: /konzentrier|sammle? (meine )?kraft|lad\w* .*(auf|zauber)|hol\w* tief luft|meditier/, target: "self", plan: "", help: "Kraft sammeln (ohne Probe): der Held hat Vorteil auf seinen nächsten Angriff oder Zauber" },
  // 🗣️ Talking
  { id: "lie_army", name: "verstaerkung_luege", combat: true, skill: "deception", dc: 14, words: /(stadt)?wache kommt|verstärkung (kommt|ist (gleich )?da)|hinter uns kommt|die armee|ritter sind (gleich )?da|wir sind (viel )?mehr/, target: "self", plan: "Angeschlagene Gegner fliehen", help: "Lüge über Verstärkung: bis zu zwei angeschlagene, gewöhnliche Gegner fliehen", setback: "enrage", oops: ["wake"] },
  { id: "haggle", name: "feilschen", combat: false, skill: "persuasion", dc: 12, words: /feilsch|handel\w* (sie|ihn|den preis)|geht('?s| das) (auch )?billiger|rabatt|zu teuer/, target: "self", plan: "Beim nächsten Einkauf 20 % billiger", help: "feilschen: der nächste Einkauf des Helden bei Händlern ist 20 % billiger", setback: "enrage", oops: ["offend"] },
  { id: "compliment", name: "kompliment", combat: false, skill: "persuasion", dc: 11, words: /kompliment|du siehst (aber )?(gut|toll|hübsch|schön)|schmeichel|lob\w* (ihn|sie|den|die)|schöne? (augen|haare|kleid)/, target: "person", plan: "Die Figur mag euch mehr", help: "Kompliment: eine Figur aus LEUTE mag die Gruppe mehr (+1)", oops: ["offend"] },
  { id: "joke", name: "witz", combat: "both", skill: "performance", dc: 11, words: /\bwitz\b|erzähl\w* (einen|was) (witz|lustiges)|bring\w* (ihn|sie) zum lachen|kalauer/, target: "person", plan: "Gelächter: man mag euch (im Kampf: Gegner abgelenkt)", help: "Witz: eine Figur mag euch mehr; im Kampf ist ein Gegner abgelenkt", oops: ["offend"] },
  { id: "song", name: "lied", combat: "both", skill: "performance", dc: 12, words: /sing|\blied\b|spiel\w* (auf der |die )?(laute|flöte|harfe|musik)|musizier|stimm\w* .* an/, target: "self", plan: "Alle Helden: Vorteil auf den nächsten Wurf", help: "Lied/Musik: alle Helden haben Vorteil auf ihren nächsten Wurf", oops: ["wake"] },
  { id: "rumors", name: "geruechte", combat: false, words: /gerücht|was erzählt man sich|neuigkeiten|was gibt'?s neues|klatsch|tratsch|was ist hier (los|passiert)/, target: "person", plan: "", help: "Gerüchte (ohne Probe): eine Figur erzählt, was man sich erzählt", oops: ["reveal"] },
  { id: "promise", name: "versprechen", combat: false, skill: "persuasion", dc: 10, words: /versprech|ich schwöre (dir|euch)|wir bringen (dir|ihnen|euch) .* zurück|ehrenwort/, target: "person", plan: "Die Figur vertraut euch (+1)", help: "Versprechen: eine Figur vertraut euch mehr (+1) und merkt sich das Versprechen" },
  { id: "why_fight", name: "warum_kaempfen", combat: true, skill: "insight", dc: 13, words: /warum kämpf|wofür kämpf|wer bezahlt euch|was hat er euch versprochen|ihr müsst das nicht tun/, target: "enemy", plan: "Der Gegner zögert", help: "Warum kämpfst du?: ein gewöhnlicher Gegner zögert (Nachteil auf seine Angriffe bis nach seinem Zug)", oops: ["enrage"] },
  { id: "apology", name: "entschuldigen", combat: false, skill: "persuasion", dc: 10, words: /entschuldig|tut (mir|uns) leid|verzeih|war nicht so gemeint/, target: "person", plan: "Die Figur ist nicht mehr böse", help: "Entschuldigung: eine verärgerte Figur ist wieder neutral" },
  { id: "accuse", name: "beschuldigen", combat: false, skill: "intimidation", dc: 10, words: /ich weiß,? was du getan hast|du warst es|ich hab(e)? (dich|beweise)|wir wissen alles/, target: "person", plan: "Die Figur gibt nach – und vergisst es euch nie", help: "Beschuldigen mit Wissen: wie Druck/drohen, aber leichter", oops: ["offend", "flee_npc"] },
  // 🔎 Exploring
  { id: "listen", name: "lauschen", combat: false, skill: "perception", dc: 10, words: /lausch|horch|ohr an (die|der) (tür|wand)|hör\w* (ich|man) (etwas|was)/, target: "self", plan: "Du hörst, wer dahinter ist", help: "lauschen: der Held hört, wie viele Gegner in der Nähe verborgen sind", oops: ["wake", "reveal"] },
  { id: "tracks", name: "spuren_lesen", combat: false, skill: "survival", dc: 12, words: /spuren|fährte|fußabdr|abdrücke|wohin (ist|sind) (er|sie) gegangen/, target: "self", plan: "Du weißt, wohin der Weg führt", help: "Spuren lesen: der Held erkennt die Richtung, in die es weitergeht", oops: ["lucky_find"] },
  { id: "keyhole", name: "schluesselloch", combat: false, skill: "perception", dc: 10, words: /schlüsselloch|durch (den|einen) spalt|unter der tür durch (schau|guck)|späh\w* durch/, target: "self", plan: "Du siehst, was hinter der Tür liegt", help: "durchs Schlüsselloch: der Bereich hinter der nächsten Tür wird sichtbar", oops: ["wake"] },
  { id: "disarm_trap", name: "falle_entschaerfen", combat: false, skill: "sleight-of-hand", dc: 12, words: /entschärf|falle .*(unschädlich|abbau|ausbau)|bau\w* die falle (ab|aus)/, target: "self", plan: "Die Falle ist weg – du kannst sie selbst nutzen", help: "Falle entschärfen: eine entdeckte Falle in der Nähe verschwindet und wird zur eigenen Stolperfalle", setback: "hurt", oops: ["trap"] },
  { id: "meal", name: "rast_essen", combat: false, words: /proviant|wir essen|kurz (was )?essen|brotzeit|kurze rast|kurze pause|verschnauf/, target: "self", plan: "", help: "kurze Rast mit Proviant (ohne Probe, einmal pro Ort): alle Helden +1W4 TP", oops: ["wake"] },
  { id: "fire", name: "feuer_machen", combat: false, skill: "survival", dc: 10, words: /(lager)?feuer (mach|entfach|anzünd)|mach\w* (ein )?(kleines )?feuer|entfach\w* .*feuer/, target: "self", plan: "Licht und Wärme für alle", help: "Feuer machen: Licht an, nasse und unterkühlte Helden wärmen sich", oops: ["fire", "wake"] },
  { id: "rope", name: "seil_spannen", combat: false, skill: "athletics", dc: 12, words: /^(?!.*(stolper|falle)).*(seil .*(über|befestig)|spann\w* .*seil .*(über|hinüber|rüber)|\bbrett\b|planke|leiter (über|hinüber|rüber)|brücke (bau|leg))/, target: "self", plan: "Ein Weg über das Hindernis", help: "Seil, Brett oder Leiter: ein Weg über Wasser oder Lücken (das Wasser in der Nähe wird begehbar)", setback: "hurt", oops: ["hurt"] },
  { id: "map", name: "karte_zeichnen", combat: false, words: /karte (zeichn|mal|aufzeichn)|zeichn\w* .*(karte|weg)|weg (auf|mit)(zeichn|schreib)/, target: "self", plan: "", help: "Karte zeichnen (ohne Probe): die Umgebung des Helden wird auf der Karte sichtbar", oops: ["reveal"] },
  { id: "herbs", name: "kraeuter_bestimmen", combat: false, skill: "nature", dc: 10, words: /giftig|essbar|kraut bestimm|pilz bestimm|pflanze (bestimm|erkenn)|welche (pflanze|pilze)|heilpflanze/, target: "self", plan: "Du findest ein Heilkraut", help: "Kräuterkunde: der Held erkennt ein brauchbares Heilkraut (zwei ergeben einen Trank)", oops: ["hurt", "lucky_find"] },
  { id: "inspect", name: "untersuchen", combat: false, skill: "investigation", dc: 12, words: /dreh\w* (den|die|das) \w+ um|(untersuch|betracht|beguck)\w* (den|die|das) (kelch|statue|bild|gemälde|buch|vase|krug|thron|brunnen)|klopf\w* .*(wand|boden) ab/, target: "self", plan: "Du findest etwas Verstecktes", help: "genau untersuchen: in einem Ding steckt etwas (Gold)", oops: ["trap", "lucky_find"] },
  { id: "drink", name: "wasser_trinken", combat: false, words: /trink\w* .*wasser|wasser (trink|abfüll)|feldflasche|schluck wasser/, target: "self", plan: "", help: "Wasser trinken (ohne Probe): nimmt eine Vergiftung, wenn sauberes Wasser in der Nähe ist" },
  // 🎭 Cunning and stealth
  { id: "hide_body", name: "leiche_verstecken", combat: false, skill: "athletics", dc: 10, words: /versteck\w* .*(leiche|körper|bewusstlos|besiegten)|schaff\w* .*(leiche|körper) (weg|beiseite)/, target: "self", plan: "Niemand findet ihn", help: "einen Besiegten verstecken: keiner schöpft Verdacht", oops: ["drop"] },
  { id: "pickpocket", name: "taschendiebstahl", combat: false, skill: "sleight-of-hand", dc: 13, words: /klau|stibitz|stehl|taschendieb|zieh\w* .*aus (seiner|ihrer) tasche|greif\w* in (seine|ihre) tasche/, target: "person", plan: "Ein paar Münzen wechseln den Besitzer", help: "Taschendiebstahl: der Held erbeutet 1W6+2 Gold (misslungen: die Figur ist wütend)", oops: ["lucky_find"] },
  { id: "bait", name: "koeder", combat: "both", skill: "animal-handling", dc: 10, words: /köder|fleisch (hin|ausleg|werf)|futter (hin|ausleg|werf)|wurst (hin|werf)|leg\w* .*(fleisch|futter|knochen) (hin|aus)/, target: "self", plan: "Die Tiere stürzen sich aufs Futter", help: "Köder: tierische Gegner sind abgelenkt (draußen: Tiere kommen angelaufen)", oops: ["wake"] },
  { id: "play_dead", name: "totstellen", combat: true, skill: "deception", dc: 12, words: /tot ?stell|stell\w* mich tot|tu so,? als (wäre|sei) ich tot/, target: "self", plan: "Die Gegner beachten dich nicht mehr", help: "totstellen: der Held liegt am Boden und wird übersehen, bis er wieder angreift", setback: "exposed", oops: ["hurt"] },
  { id: "shadows", name: "schatten", combat: "both", skill: "stealth", dc: 12, words: /durch (den|die) schatten|im schatten (schleich|lauf|bleib)|schatten nutz/, target: "self", plan: "Niemand sieht dich", help: "durch die Schatten: der Held ist versteckt", oops: ["slip"] },
  { id: "false_trail", name: "falsche_spur", combat: false, skill: "deception", dc: 12, words: /falsche spur|spuren verwisch|in die irre (führ|leit)|verwisch\w* .*spur/, target: "self", plan: "Verfolger laufen in die falsche Richtung", help: "falsche Spur: die nächste Gefahr der Welt geht an der Gruppe vorbei" },
  { id: "sleep_herb", name: "schlafkraut", combat: false, skill: "sleight-of-hand", dc: 13, words: /schlafkraut|schlafmittel|ins (essen|getränk|bier|wasser) (misch|streu|kipp)|misch\w* .*ins (essen|bier)/, target: "self", plan: "Die Wachen schlafen ein", help: "Schlafkraut ins Essen: wachende Gegner in der Nähe schlafen ein", oops: ["offend"] },
  // 🤝 Together
  { id: "boost", name: "raeuberleiter", combat: "both", words: /räuberleiter|räuber ?leiter|hilf\w* (ihm|ihr|dir) (hoch|rauf)|heb\w* (ihn|sie) hoch/, target: "hero", plan: "", help: "Räuberleiter (ohne Probe): ein anderer Held steht erhöht", oops: ["slip_friend"] },
  { id: "toss_friend", name: "held_werfen", combat: "both", skill: "athletics", dc: 14, words: /wirf mich|werf\w* mich|schleuder\w* mich|wirf (ihn|sie) rüber|werf\w* (ihn|sie) (rüber|hinüber)/, target: "self", plan: "Ein großer Satz über das Hindernis", help: "einen Helden werfen: ein großer Sprung bis 4 Felder", setback: "fall", oops: ["hurt"] },
  { id: "shieldwall", name: "schildwall", combat: true, words: /schildwall|stell\w* uns zusammen|rück\w* zusammen|rücken an rücken|schulter an schulter/, target: "self", plan: "", help: "Schildwall (ohne Probe): der Held und Helden direkt neben ihm +2 RK für 1 Runde" },
  { id: "watch", name: "wache_halten", combat: false, words: /halt\w* wache|wache halten|pass\w* auf,? dass|ich pass auf|schieb\w* wache/, target: "self", plan: "", help: "Wache halten (ohne Probe): die nächste Gefahr der Welt trifft die Gruppe nicht unvorbereitet" },
  { id: "encourage", name: "mut_machen", combat: "both", words: /du schaffst das|mut (zu|mach)|aufmunter|kopf hoch|keine angst|wir schaffen das/, target: "hero", plan: "", help: "Mut machen (ohne Probe): ein Held verliert die Angst und hat Vorteil auf den nächsten Wurf" },
  { id: "stabilize", name: "stabilisieren", combat: "both", skill: "medicine", dc: 10, words: /stabilisier|wiederbeleb|weck\w* (ihn|sie) auf|bewusstlos.*(versorg|hilf)|reanimier/, target: "hero", plan: "Der Held kommt wieder zu sich (1 TP)", help: "stabilisieren: ein bewusstloser Held kommt mit 1 TP wieder zu sich" },
  // 🐾 Animals and companions
  { id: "calm", name: "beruhigen", combat: true, skill: "animal-handling", dc: 11, words: /beruhig|streichel|redet? ruhig auf|ganz ruhig,? (mein|kleiner|braver)|sanft zu/, target: "enemy", plan: "Das Tier beruhigt sich und kämpft nicht mehr", help: "beruhigen: ein Tier (Wolf, Bär, Spinne …) hört auf zu kämpfen", setback: "enrage", oops: ["enrage"] },
  { id: "fetch", name: "apportieren", combat: false, words: /hol das|apport|bring\w* (mir|uns) (das|den|die)|such!|fass\w* nicht,? hol/, target: "self", plan: "", help: "Begleiter holt etwas (ohne Probe): ein Liegendes in der Nähe kommt zum Helden (nur mit Tier-Begleiter)", oops: ["lucky_find"] },
  { id: "scout", name: "auskundschaften", combat: false, words: /kundschaft|(katze|hund|vogel|rabe),? (schau|sieh|flieg|lauf)|schick\w* (meinen|meine|den|die) .*(vor|voraus)/, target: "self", plan: "", help: "Begleiter kundschaftet aus (ohne Probe): die Umgebung wird sichtbar (nur mit Tier-Begleiter)", oops: ["wake"] },
  { id: "ride", name: "reiten", combat: "both", words: /\breit(e|en|est)?\b|aufs pferd|auf das pferd|aufsitzen|\bsitz\w* auf (das|dem) (pferd|pony)/, target: "self", plan: "", help: "reiten (ohne Probe, nur mit Pferd daneben): doppelte Bewegung in diesem Zug", oops: ["slip"] },
  // 😄 Fun
  { id: "dance", name: "tanzen", combat: "both", skill: "performance", dc: 11, words: /\btanz|tänzel|mach\w* .*tänzchen|wackel\w* mit dem (po|hintern)/, target: "enemy", plan: "Alle schauen verwirrt zu", help: "tanzen: im Kampf sind zwei Gegner abgelenkt; sonst mag eine Figur euch mehr", oops: ["slip"] },
  { id: "call_name", name: "beim_namen_rufen", combat: true, words: /^ ?(hey|he|hallo|oi),? [a-zäöü]+\b|ruf\w* (ihn|sie|den|die) beim namen|ruf\w* .*(gerd|karl|horst|kevin)/, target: "enemy", plan: "", help: "beim Namen rufen (ohne Probe): ein Gegner dreht sich verwirrt um (abgelenkt)", oops: ["enrage"] },
  { id: "ghost", name: "gespenst", combat: "both", skill: "intimidation", dc: 12, words: /gespenst|als geist|\bbuh+\b|spuk|heul\w* wie ein (geist|gespenst)|tu so,? als (wäre|sei) ich ein (geist|gespenst)/, target: "enemy", plan: "Der Gegner bekommt Angst", help: "Gespenst spielen: ein Gegner bekommt 1 Runde Angst (im Dunkeln leichter)", setback: "exposed", oops: ["scare_friend", "flee_npc"] },
  { id: "tickle", name: "kitzeln", combat: true, skill: "sleight-of-hand", dc: 12, words: /kitzel|pfeffer|niespulver|nies\w* (ihn|sie)|juckpulver/, target: "enemy", plan: "Der Gegner ist behindert", help: "kitzeln/Pfeffer: ein Gegner (kein Anführer) muss niesen oder lachen – Nachteil bis nach seinem Zug", setback: "fumble", oops: ["enrage"] },
];

const BY_ID = new Map(STUNTS.map((s) => [s.id, s]));
const BY_NAME = new Map(STUNTS.map((s) => [s.name, s]));

export function stuntById(id: string): Stunt | undefined {
  return BY_ID.get(id);
}

export function stuntByName(name: string): Stunt | undefined {
  return BY_NAME.get(name);
}

const fits = (s: Stunt, fighting: boolean) => s.combat === "both" || s.combat === fighting;

/** The stunt a text is about (the first that fits the situation), if any. */
export function stuntOf(text: string, fighting: boolean): Stunt | undefined {
  const t = ` ${text.toLowerCase()} `;
  return STUNTS.find((s) => fits(s, fighting) && s.words.test(t));
}

/** Every stunt the text might mean (for the AI: only these go into its toolbox – saves tokens). */
export function stuntsIn(text: string, fighting: boolean): Stunt[] {
  const t = ` ${text.toLowerCase()} `;
  return STUNTS.filter((s) => fits(s, fighting) && s.words.test(t)).slice(0, 3);
}
