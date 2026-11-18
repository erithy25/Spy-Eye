/**
 * Screens search and watch prompts before they reach the model.
 *
 * The platform answers questions about scenes, objects and events. It must not be usable to
 * single out a named individual or to sort people by protected characteristics:
 *   - AI Act Art. 5(1)(g): biometric categorisation by sensitive attributes is prohibited;
 *   - GDPR Art. 9: special categories of personal data;
 *   - the vision model has seen public figures in training, so a name is effectively a face query.
 *
 * The screen is deliberately conservative and rule-based: it is auditable, and every refusal is
 * written to the ledger with the rule that fired.
 */

export interface GuardVerdict {
  allowed: boolean;
  /** Machine-readable rule id, e.g. `protected-attribute`. */
  rule: string | null;
  reason: string | null;
  reasonEn: string | null;
  /**
   * Remarks on an allowed prompt that an auditor should be able to filter for, e.g.
   * `person-description` when the prompt describes people by sex or age group.
   */
  flags: string[];
}

export interface GuardOptions {
  /** Whether the mandate permits describing persons by sex or age group. */
  personDescriptions: boolean;
}

/** Terms that sort people by origin, religion, health, sexuality or political stance. */
const PROTECTED_TERMS: readonly string[] = [
  // origin / ethnicity
  'ethnic', 'ethnicity', 'racial', 'skin color', 'skin colour', 'dark-skinned', 'dark skinned', 'light-skinned',
  'gypsy', 'roma', 'sinti', 'foreigner', 'foreign-looking', 'immigrant', 'migrant', 'refugee', 'jewish looking',
  'arabic looking',
  // religion
  'muslim', 'moslem', 'islamic', 'jew', 'jews', 'jewish', 'christian', 'hindu', 'sikh', 'buddhist', 'hijab', 'headscarf',
  'kippah', 'yarmulke', 'turban', 'burqa', 'niqab', 'kopftuch', 'religious',
  // sexuality / gender identity
  'gay', 'lesbian', 'homosexual', 'transgender', 'trans person', 'queer', 'lgbt',
  // health as a sorting criterion
  'mentally ill', 'hiv', 'pregnant',
  // politics
  'antifa', 'communist', 'nazi', 'activist', 'union member', 'gewerkschaft',
];

/** German word stems for the same thing; matched anywhere in a word to cover inflection. */
const PROTECTED_STEMS: readonly string[] = [
  'auslander', 'auslandisch', 'sudlander', 'sudlandisch', 'fluchtling', 'migrant', 'dunkelhautig', 'hautfarbe',
  'zigeuner', 'asylbewerber', 'moslem', 'muslim', 'homosexuell',
];

/**
 * Words that are harmless for objects ("asian restaurant", "white van", "black smoke") and only
 * become a protected attribute when they describe a person.
 */
const ORIGIN_ADJECTIVES: readonly string[] = [
  'black', 'white', 'asian', 'african', 'arab', 'arabic', 'hispanic', 'latino', 'latina', 'caucasian', 'turkish',
  'syrian', 'afghan', 'polish', 'russian', 'romanian', 'chinese', 'indian', 'foreign',
];
const PERSON_NOUNS: readonly string[] = [
  'person', 'persons', 'people', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'child', 'children',
  'kid', 'kids', 'guy', 'guys', 'male', 'males', 'female', 'females', 'youth', 'youths', 'teenager', 'teenagers',
  'family', 'families', 'driver', 'suspect', 'individual', 'individuals', 'mann', 'manner', 'frau', 'frauen', 'leute',
  'personen', 'jugendliche', 'kinder',
];

/**
 * Bodily features that single a person out. The AI Act (recital 16) counts hair colour, eye
 * colour and tattoos among biometric categories; this system does not sort people by them.
 */
const IDENTIFYING_FEATURES: readonly string[] = [
  'hair', 'haired', 'blond', 'blonde', 'brunette', 'redhead', 'bald', 'beard', 'bearded', 'moustache', 'mustache',
  'tattoo', 'tattoos', 'tattooed', 'scar', 'scarred', 'birthmark', 'piercing', 'freckles', 'eye color', 'eye colour',
  'blue eyes', 'brown eyes', 'green eyes', 'haare', 'haarfarbe', 'bart', 'tatowierung', 'tatowiert', 'narbe', 'glatze',
];

/** Words that describe a person by sex or age group. Allowed only where the mandate says so. */
const SEX_AGE_TERMS: readonly string[] = [
  'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'male', 'female', 'lady', 'gentleman', 'guy', 'guys',
  'child', 'children', 'kid', 'kids', 'baby', 'babies', 'toddler', 'infant', 'teenager', 'teenagers', 'teen', 'youth',
  'elderly', 'senior', 'seniors', 'old man', 'old woman', 'young man', 'young woman', 'mann', 'manner', 'frau', 'frauen',
  'junge', 'madchen', 'kind', 'kinder', 'jugendliche', 'jugendlicher', 'senioren', 'greis',
];

/** Phrases that ask for identification rather than description. */
const IDENTITY_PHRASES: readonly string[] = [
  'who is', 'identify', 'identity of', 'name of the', 'recognize the person', 'recognise the person', 'face of',
  'facial recognition', 'face recognition', 'find this person', 'same person', 'track the person', 'follow the person',
  'license plate number', 'licence plate number', 'number plate', 'kennzeichen', 'wer ist', 'identifiziere',
  'gesichtserkennung', 'verfolge',
];

/**
 * Frequent given names (German, English, Turkish, Arabic, Slavic, Romance). A name in a prompt
 * means the query targets an individual. Names that are also everyday words (max, mark, iris, …)
 * are left out on purpose: a missed name still only yields scene matches, a false refusal blocks
 * legitimate work.
 */
const GIVEN_NAMES: ReadonlySet<string> = new Set(
  (
    'aaron abdul achim adrian ahmed ahmet albert alexander alexandra alice alina amelie andrea andreas angela ' +
    'angelika anja anke anna annette anton antonia armin arne astrid aylin ayse barbara bastian beate benjamin ' +
    'bernd bernhard bettina bianca birgit bjorn boris brigitte carina carlos carolin caroline carsten catherine ' +
    'charlotte christa christian christiane christin christina christine christoph claudia claus clemens ' +
    'cornelia dagmar daniel daniela david dennis detlef dieter dietmar dirk dmitri dominik donald doris dorothea ' +
    'edith eduard elena elias elif elisabeth elke ellen emilia emily emre erika erwin esra fabian fatih fatima ' +
    'fatma felix florian franz franziska frederik friedrich fritz gabi gabriel gabriele georg gerda gerhard ' +
    'gertrud gisela giuseppe gregor greta gudrun guido gunter gustav hakan hamza hanna hannah hannes harald ' +
    'hasan hassan heidi heike heiko heinrich heinz helen helena helene helga helmut hendrik henrik herbert ' +
    'hermann hildegard holger horst hubert hussein ibrahim ingrid irina isabel isabell isabella ivan jakob ' +
    'janina jannik jasmin jennifer jens jessica joachim jochen johann johanna johannes jonas jonathan jorg josef ' +
    'joseph julian juliane jurgen jutta karin karla karsten katharina kathrin katja katrin kemal kerstin kevin ' +
    'khalid klaus konrad konstantin kristin leah leonie liam lothar louisa lucas ludwig luisa lukas magdalena ' +
    'mahmoud maja malte manfred manuel manuela marcel marcus mareike margarete maria marianne marie marina ' +
    'marion marius markus marlene marta martha martin martina mathias matthias maximilian mehmet melanie melissa ' +
    'meryem michael michaela michelle miriam mohamed mohammad mohammed monika moritz muhammad murat mustafa ' +
    'nadine nadja natalie natascha nicolas nicole niklas nina norbert olaf oleg olga oliver omar oskar pascal ' +
    'patricia patrick paul paulina pawel peter petra philip philipp piotr rainer ralph ramona raphael rebecca ' +
    'regina reinhard renate roland rosemarie rudolf sabine sabrina sarah sascha sebastian selin sergej sibylle ' +
    'siegfried sigrid silke silvia simon simone sofia sonja sophia sophie stefan stefanie steffen stephan ' +
    'stephanie susanne svenja svetlana sylvia tamara tanja tatjana theodor theresa thomas thorsten timo tobias ' +
    'torsten ulrich ulrike ursula valentin vanessa verena veronika viktor viktoria vladimir volker walter ' +
    'waltraud werner wilhelm wladimir wolfgang yasemin yusuf yvonne zeynep ' +
    // public figures frequently used to test such systems
    'merkel scholz merz trump biden putin macron obama selenskyj zelensky habeck baerbock lindner soder musk'
  ).split(' '),
);

/** Honorifics and role words that signal a personal name follows. */
const NAME_MARKERS: readonly string[] = ['mr', 'mrs', 'ms', 'herr', 'frau', 'dr', 'prof', 'minister', 'president', 'kanzler'];

/** Lower-case, diacritics removed, whitespace collapsed. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(normalized: string): string[] {
  return normalized.split(/[^a-z0-9-]+/).filter((t) => t !== '');
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whole-word match that also accepts a plural "s"; inflected German forms match by stem. */
const PROTECTED_PATTERNS: readonly { term: string; pattern: RegExp }[] = PROTECTED_TERMS.map((term) => {
  const norm = normalize(term);
  return { term, pattern: new RegExp(`(^|[^a-z])${escapeRegExp(norm)}(s|e|er|en|em|es|isch\\w*)?($|[^a-z])`) };
});
const IDENTITY_NORMALIZED: readonly string[] = IDENTITY_PHRASES.map(normalize);

const refuse = (rule: string, reason: string, reasonEn: string): GuardVerdict => ({
  allowed: false,
  rule,
  reason,
  reasonEn,
  flags: [],
});

const containsTerm = (text: string, words: readonly string[], term: string): boolean =>
  term.includes(' ') ? text.includes(term) : words.includes(term);

export function screenPrompt(raw: string, options: GuardOptions = { personDescriptions: true }): GuardVerdict {
  const text = normalize(raw);
  const words = tokens(text);

  for (const phrase of IDENTITY_NORMALIZED) {
    if (text.includes(phrase)) {
      return refuse(
        'identification',
        'Die Anfrage zielt auf die Identifizierung einer Person oder eines Kennzeichens. Dieses System beschreibt Lagen, es identifiziert niemanden.',
        'The request aims at identifying a person or a licence plate. This system describes situations; it identifies no one.',
      );
    }
  }
  const protectedTerm =
    PROTECTED_PATTERNS.find(({ pattern }) => pattern.test(text))?.term ??
    PROTECTED_STEMS.find((stem) => text.includes(stem)) ??
    // "<origin adjective> <person noun>", with at most one word in between ("black young man").
    ORIGIN_ADJECTIVES.find((adjective) =>
      words.some((w, i) => w === adjective && words.slice(i + 1, i + 3).some((n) => PERSON_NOUNS.includes(n))),
    );
  if (protectedTerm !== undefined) {
    return refuse(
      'protected-attribute',
      `Die Anfrage sortiert Menschen nach einem geschützten Merkmal („${protectedTerm}“). Das ist ausgeschlossen (Art. 9 DSGVO, Art. 5 KI-Verordnung).`,
      `The request sorts people by a protected characteristic ("${protectedTerm}"). This is excluded (GDPR Art. 9, AI Act Art. 5).`,
    );
  }
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as string;
    const next = words[i + 1];
    if (GIVEN_NAMES.has(word) || (NAME_MARKERS.includes(word) && next !== undefined && next.length > 2)) {
      return refuse(
        'named-person',
        'Die Anfrage enthält einen Personennamen. Die Suche nach benannten Personen ist ausgeschlossen.',
        'The request contains a personal name. Searching for named individuals is excluded.',
      );
    }
  }

  // Bodily features only matter when the prompt is about a person ("a red-haired woman"), not
  // about an animal or an object ("a dog with long hair" still describes a scene).
  const aboutPerson = [...PERSON_NOUNS, ...SEX_AGE_TERMS].some((noun) => containsTerm(text, words, noun));
  const feature = IDENTIFYING_FEATURES.find((term) => containsTerm(text, words, term));
  if (aboutPerson && feature !== undefined) {
    return refuse(
      'identifying-feature',
      `Die Anfrage beschreibt eine Person über ein körperliches Merkmal („${feature}“). Solche Merkmale gelten als biometrische Kategorien (KI-Verordnung, Erwägungsgrund 16) und sind hier ausgeschlossen. Kleidung, Ausrüstung, Haltung und Situation sind zulässig.`,
      `The request describes a person by a bodily feature ("${feature}"). Such features count as biometric categories (AI Act, recital 16) and are excluded here. Clothing, equipment, posture and situation are permitted.`,
    );
  }

  const sexAge = SEX_AGE_TERMS.find((term) => containsTerm(text, words, term));
  if (sexAge !== undefined) {
    if (!options.personDescriptions) {
      return refuse(
        'person-description',
        `Dieses Mandat lässt keine Beschreibung von Personen nach Geschlecht oder Alter zu („${sexAge}“). Bitte neutral formulieren, zum Beispiel „person“.`,
        `This mandate does not permit describing persons by sex or age group ("${sexAge}"). Please use a neutral wording such as "person".`,
      );
    }
    return { allowed: true, rule: null, reason: null, reasonEn: null, flags: ['person-description'] };
  }
  return { allowed: true, rule: null, reason: null, reasonEn: null, flags: [] };
}
